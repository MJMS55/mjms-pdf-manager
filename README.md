# MJMS-PDF-Manager

Version 0.4.6. Application native d’identifiant **mjms_pdf_manager**, namespace **OCA\MJMSPDFManager**. Cible déclarée : Nextcloud 34 à 36. La compatibilité effective avec Nextcloud 35 et 36 reste à valider sur des instances réelles avant publication. Le dossier installé doit s’appeler `mjms_pdf_manager`.

## Correctif 0.3.1

Les fenêtres natives fermées sont explicitement masquées pour résister aux styles globaux de Nextcloud. Cela corrige notamment « Choisir des PDF » visible en permanence. Le style en grille de l’éditeur ouvert est conservé. Mettre à jour uniquement Manager, puis recharger avec Ctrl+F5.

## Nouveautés 0.3.0

- Barre supérieure compacte : commandes raccourcies et bouton Annoter à proximité des imports.
- Confirmation avant remplacement d’un PDF existant ; nouvelle confirmation si sa version ou son identifiant a changé.
- Action **Ouvrir dans MJMS-PDF-Manager** dans le menu de fichier PDF de Nextcloud (menu ⋯ et menu contextuel lorsqu’il est proposé par Fichiers). Une seule sélection, avec droit de lecture.
- Ouverture depuis le menu **Actions** de MJMS-PDF-Viewer **1.1.0** dans un nouvel onglet. Installer les deux mises à jour. Le menu apparaît uniquement si Manager est activé pour l’utilisateur connecté.
- Le nom et le dossier du PDF ouvert directement sont proposés pour son enregistrement.

Fonctions conservées depuis 0.2.0 :

- Éditeur d’annotations dans une fenêtre presque plein écran, zoom, défilement et navigation entre pages.
- Suppression annotation par annotation, avec annulation ; les autres annotations sont conservées.
- Envoi du PDF complet en pièce jointe : destinataire, objet, message et nom du fichier personnalisables.

## Mise à jour depuis une version précédente

Exportez votre travail en cours avant de recharger l’application. Décompressez le nouveau ZIP puis remplacez les fichiers du dossier `apps/mjms_pdf_manager` de votre serveur par ceux du dossier `mjms_pdf_manager` de l’archive. Ne créez pas un deuxième dossier imbriqué. Gardez les droits et le propriétaire du dossier existant. Si Nextcloud demande une mise à jour, terminez-la dans son interface d’administration ou avec `sudo -u www-data php occ upgrade` depuis la racine Nextcloud. Rechargez ensuite la page (Ctrl+F5). Aucune migration de base de données n’est nécessaire pour cette version.

## Envoi par mail

Le bouton **Envoyer par mail** joint le PDF résultant avec toutes les pages et annotations actuelles. L’enregistrement préalable dans Fichiers n’est pas nécessaire. Un destinataire par message ; pièce jointe limitée à **10 Mio** et cinq demandes d’envoi par utilisateur sur cinq minutes. La limite SMTP réelle peut être inférieure et l’encodage de la pièce jointe augmente la taille du message.

Configurer et tester le serveur de messagerie dans **Paramètres d’administration → Paramètres de base → Serveur e-mail** de Nextcloud. L’application utilise `OCP\Mail\IMailer`, pas l’application Nextcloud Mail ni le logiciel de messagerie du poste. L’expéditeur est celui configuré sur le serveur ; l’adresse du compte utilisateur est placée en Reply-To si elle est valide. Aucun mot de passe SMTP n’est demandé ni stocké par cette application.

L’envoi n’a lieu qu’après le clic sur **Envoyer avec la pièce jointe**. La confirmation signifie que le transport a accepté le message, pas que la boîte du destinataire l’a reçu. En cas d’échec ou de résultat incertain, vérifier la configuration et les journaux avant de réessayer. Les tests locaux utilisent exclusivement un transport simulé : aucun mail réel n’a été envoyé.

## Fonctions

- Import multiple depuis l’ordinateur ou sélection de PDF dans un dossier Nextcloud.
- Fusion de toutes les pages importées dans l’ordre affiché, au moment de l’export.
- Vignettes, glisser-déposer, boutons de déplacement utilisables au clavier, suppression et annulation (20 étapes).
- Annotations de texte, surlignage rectangulaire, dessin libre ; coordonnées adaptées aux pages pivotées et rognées.
- Téléchargement local ou création d’un PDF dans un dossier Nextcloud accessible en écriture. Un nom existant ouvre une confirmation explicite ; annuler conserve le fichier. Le remplacement utilise le droit de modification du fichier et conserve son identifiant Nextcloud.
- Interface française utilisant les couleurs et styles Nextcloud, adaptation aux petits écrans et au thème sombre.

## Installation du paquet compilé

Le ZIP de livraison comprend un dossier `mjms_pdf_manager`, les sources et les ressources compilées. Il n’inclut pas `node_modules`. Aucun Composer, FPDI, Ghostscript ni service externe n’est nécessaire.

Sur le serveur Linux Nextcloud (adapter `/var/www/nextcloud` et l’utilisateur PHP) :

```sh
unzip mjms_pdf_manager-0.4.6.zip -d /var/www/nextcloud/apps/
chown -R www-data:www-data /var/www/nextcloud/apps/mjms_pdf_manager
cd /var/www/nextcloud
sudo -u www-data php occ app:enable mjms_pdf_manager
```

Le dossier `apps` standard convient si votre configuration Nextcloud l’utilise. Si votre installation utilise un autre dossier déclaré dans `apps_paths`, adaptez les chemins ci-dessus ; `custom_apps` n’est pas obligatoire. PHP doit être une version prise en charge par votre installation Nextcloud 34 ; le code de cette app utilise PHP 8.2 minimum. Configurez `upload_max_filesize = 50M`, `post_max_size = 64M` et une mémoire PHP suffisante (512M conseillé). Alignez la limite du reverse proxy (par exemple `client_max_body_size 64m` dans Nginx). Les fichiers `.mjs` doivent être servis en JavaScript, les `.wasm` en `application/wasm`, pas par PHP.

Ouvrir ensuite **MJMS PDF** dans la navigation Nextcloud. L’application n’est pas encore publiée ni signée pour l’App Store. Ne pas utiliser `occ app:enable --force` sur une autre version.

## Construction depuis les sources

Node.js 22.13+ ou 24 LTS et npm. Les versions exactes figurent dans `package.json` et `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:php
npm audit --omit=dev
```

PDF.js 6.3.289 (Mozilla, Apache-2.0) rend les pages et utilise un worker local. pdf-lib 1.17.1 (MIT) copie les pages et écrit les annotations. `@nextcloud/files` 4.1.0 enregistre l’action dans Fichiers. `@nextcloud/router` et `@nextcloud/auth` génèrent les URL et transmettent le jeton CSRF. esbuild compile le JavaScript ; php-parser vérifie la syntaxe PHP dans les tests. Les licences tierces et notices du bundle sont livrées avec l’application.

## Architecture et sécurité

- `appinfo/info.xml` : métadonnées, navigation, compatibilité 34.
- `appinfo/routes.php`, `lib/Controller/` : contrôleurs AppFramework et injection de dépendances ; aucune API privée Nextcloud.
- `GET /api/files?path=…` : dossiers et PDF lisibles de l’utilisateur courant.
- `GET /api/source?fileId=…` : métadonnées d’un PDF accessible dans le dossier utilisateur.
- `GET /api/pdf?path=…` ou `?fileId=…` : contenu d’un PDF, réponse non mise en cache.
- `POST /api/mail` : multipart `to`, `subject`, `body`, `name`, `pdf` ; authentification, CSRF, limite de débit, contrôle du destinataire et de la pièce jointe. Aucun expéditeur arbitraire fourni par le client.
- `POST /api/pdf` : multipart `folder`, `name`, `pdf` ; création via `OCP\Files\Folder` ou remplacement via `File::putContent` après confirmation (`overwrite`, `expectedId`, `expectedEtag`).
- Les routes fichiers conservent l’authentification et la protection CSRF Nextcloud, y compris en lecture. Seule la page d’entrée a `NoCSRFRequired`.
- Aucun chemin système fourni par le client, accès limité à `IRootFolder::getUserFolder()` ; validation des noms, permissions, taille et signature PDF. La vérification de signature n’est pas un antivirus ni une validation exhaustive du format.
- La CSP autorise les workers de même origine et WebAssembly pour les décodeurs PDF.js. `isEvalSupported: false`, aucun CDN ni envoi vers un service tiers.
- `src/pdf.js` : moteur d’export indépendant de l’interface. `src/main.js` : état du document, historique, rendu et interactions.

## Limites de cette première version

50 Mio cumulés à l’import, 50 Mio à l’export et 300 pages. Les fichiers importés restent en mémoire pour permettre l’annulation ; « Vider l’atelier » libère cette mémoire. Enregistrer avant de quitter : les données d’édition sont intégrées au PDF MJMS. Les grandes numérisations peuvent consommer beaucoup de mémoire malgré ces limites.

Les PDF chiffrés sont refusés. Les annotations sont intégrées visuellement et accompagnées de données MJMS permettant leur réédition après réimport dans Manager. Les autres lecteurs affichent le rendu, sans éditer cette couche. Le PDF contient une copie des pages avant annotations : ne pas utiliser ce mécanisme pour masquer ou caviarder des données confidentielles. Le texte utilise Helvetica/WinAnsi : accents français pris en charge, emojis et écritures non latines refusés explicitement. Pas d’OCR, de caviardage sécurisé, de signature numérique ou d’édition du texte original. La copie des pages ne garantit pas la conservation des signatures, signets, pièces jointes, formulaires interactifs et autres données au niveau du document. Pour des formulaires, exporter préalablement une copie aplatie.

Le remplacement compare l’identifiant et l’ETag avant écriture ; une modification détectée demande une nouvelle confirmation. Ce contrôle optimiste ne verrouille pas toute la durée de l’opération : les écritures exactement simultanées par un autre client restent à qualifier en intégration. Conserver une copie distincte pour les documents nécessitant cette garantie.

## Validation et recette sur serveur

Les tests automatisés vérifient le texte réellement extrait des PDF fusionnés/annotés, l’ordre après suppression/déplacement, la géométrie des pages et la syntaxe PHP. L’aperçu local `node tests/preview.mjs` sert des PDF fictifs et simule le stockage et le transport mail : **ce n’est pas un serveur Nextcloud**. Il est limité à 127.0.0.1:8765 et ne doit pas être déployé comme service.

Avant utilisation en production sur Nextcloud 34 :

1. Activer l’app avec `occ`, ouvrir avec un compte non administrateur ; vérifier l’absence d’erreurs dans `nextcloud.log` et la console navigateur.
2. Importer deux PDF locaux et deux fichiers Nextcloud ; vérifier toutes les pages et leur ordre.
3. Déplacer par glisser-déposer et boutons, supprimer, annuler, annoter (y compris une page pivotée).
4. Exporter puis ouvrir dans une autre visionneuse ; comparer les annotations et pages.
5. Enregistrer dans un dossier autorisé, vérifier le contenu dans Fichiers ; tester nom existant, dossier sans droits et quota dépassé.
6. Vérifier que les requêtes sans session ou jeton CSRF sont refusées et qu’un compte ne peut pas lire le dossier d’un autre.
7. Ouvrir un PDF depuis le menu Fichiers puis depuis Actions dans MJMS-PDF-Viewer 1.1.0 ; contrôler le nom et le dossier proposés, les fichiers partagés en lecture seule et les sous-dossiers. Vérifier le masquage du lien Viewer lorsque Manager est désactivé.
8. Tester PDF chiffré, corrompu, taille excessive, thème sombre et navigateur mobile.

La version 0.3.0 a été vérifiée avec neuf tests JavaScript/PDF et dix-huit scénarios du contrôleur fichiers, un interpréteur PHP 8.4 pour la syntaxe et les scénarios du contrôleur mail, ainsi que dans un navigateur (éditeur, zoom, suppression individuelle et envoi simulé). Le test PHP remplace les interfaces Nextcloud et le transport mail par des doublures ; il ne constitue pas une intégration sur un serveur Nextcloud. L’intégration Nextcloud 34 et la distribution SMTP réelle restent à valider sur votre instance.

## Audit initial

L’ébauche annonçait Nextcloud 20 avec d’anciennes balises `require`, trois espaces de noms incompatibles, des contrôleurs hors `lib/`, des routes non standard et FPDI absent des dépendances. Sa fusion ne copiait que la première page. Conformément à la demande, elle a été remplacée par cette architecture ciblée Nextcloud 34.

Références : [contrôleurs Nextcloud](https://docs.nextcloud.com/server/stable/developer_manual/basics/controllers.html), [API Files Nextcloud 34](https://github.com/nextcloud/server/blob/stable34/lib/public/Files/Folder.php), [PDF.js](https://mozilla.github.io/pdf.js/), [pdf-lib](https://pdf-lib.js.org/).



## Éditeur interactif

Sélection et déplacement, poignée de redimensionnement, texte rééditable avec « Appliquer à la sélection », surlignage de zone, dessin Pointer Events avec pression du stylet, rectangle, ellipse, ligne et flèche. Couleur, taille (8–96 points), épaisseur et opacité sont réglables. Annuler/rétablir conserve 20 étapes ; navigation et zoom utilisent les coordonnées PDF, y compris rotation et rognage. Le tactile dessine avec un doigt ; utiliser le défilement extérieur au canvas pour naviguer.

Le PDF exporté conserve une copie propre et un modèle multipage MJMS versionné dans deux flux compressés du catalogue PDF. Après réimport local ou Nextcloud, les annotations sont restaurées et modifiables sans double rendu. Une réécriture par un autre logiciel peut supprimer ces données. Le surlignage est rectangulaire, sans sélection sémantique du texte. Aucun brouillon automatique avant enregistrement.


## Correctif d’interaction 0.4.0

L’ajout d’un texte ouvre une saisie directement sur la page. Après validation, l’outil Sélection est activé automatiquement. Un texte existant reste sélectionnable et déplaçable même depuis l’outil Texte. Quatre poignées de 32 pixels CSS (40 sur écran tactile) permettent d’agrandir et de réduire sans dépendre du zoom ni de la densité d’écran. Le bouton flottant « Modifier le texte » réédite le texte sur la page ; Ctrl+Entrée valide, Échap annule. Les mouvements ne relancent plus le rendu PDF complet, ce qui conserve le zoom et le défilement. Le numéro 0.4.0 figure dans l’éditeur pour identifier la version effectivement chargée. Après remplacement du paquet, exécuter `occ upgrade` puis recharger le navigateur. Ce correctif reproduit ces gestes usuels d’un éditeur de notes, sans prétendre couvrir toutes les fonctions Samsung Notes.


## Présentation 0.4.1

Les huit outils d’annotation apparaissent sous forme d’icônes dans la colonne de droite, à la place de la liste Outil. Chaque bouton possède une infobulle et un nom accessible français ; l’outil actif est indiqué par sa couleur et son état pressé. Les poignées affichent un rond de 8 pixels, avec une zone transparente de prise de 24 pixels à la souris et 32 au tactile. Le numéro 0.4.1 dans l’éditeur permet de vérifier le chargement de cette mise à jour.


## Présentation 0.4.2

En-tête de l’éditeur sur une seule ligne : titre/version, page/fichier, flèches de navigation, zoom, annuler/rétablir et Terminer. Les notifications sont dans la colonne de droite et ne réservent plus d’espace au-dessus du PDF. Les noms longs sont tronqués visuellement ; sur un écran étroit la barre défile horizontalement.

## Licence

Copyright MJMS. Code distribué sous GNU AGPL version 3 ou ultérieure (AGPL-3.0-or-later). Voir LICENSE.

## Langues / Languages

L’interface suit la langue du compte Nextcloud : français (`fr`), anglais (`en`), allemand (`de`), espagnol (`es`), italien (`it`), néerlandais (`nl`), polonais (`pl`) et basque (`eu`). Les catalogues `l10n/*.json` et `l10n/*.js` couvrent l’interface, les aides, l’accessibilité, l’action du menu Fichiers et les messages des contrôleurs. Les descriptions de l’application sont également localisées dans `appinfo/info.xml`.

The interface follows the Nextcloud account language. When updating translations, keep the JSON and JavaScript catalogs synchronized and preserve placeholders such as `{count}`, `{number}` and `{name}`. Run `npm test`, `npm run test:php` and `npm run build` after changes. PDF annotation text remains subject to the existing PDF font character restrictions.
