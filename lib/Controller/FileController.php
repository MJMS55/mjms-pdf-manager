<?php
declare(strict_types=1);
namespace OCA\MJMSPDFManager\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\Files\IRootFolder;
use OCP\Files\Folder;
use OCP\Files\File;
use OCP\IRequest;
use OCP\IUserSession;

class FileController extends Controller
{
    private const MAX_BYTES = 52428800;
    public function __construct(
        IRequest $request,
        private IRootFolder $root,
        private IUserSession $session,
    ) {
        parent::__construct("mjms_pdf_manager", $request);
    }
    private function home(): Folder
    {
        $user = $this->session->getUser();
        if ($user === null) {
            throw new \RuntimeException("Authentification requise.");
        }
        return $this->root->getUserFolder($user->getUID());
    }
    private function path(string $path): string
    {
        if (
            str_contains($path, "\0") ||
            str_contains($path, "\\") ||
            preg_match('~(^|/)\.\.?(/|$)~', $path)
        ) {
            throw new \InvalidArgumentException("Chemin invalide.");
        }
        return trim($path, "/");
    }
    private function folder(string $path): Folder
    {
        $home = $this->home();
        $path = $this->path($path);
        $node = $path === "" ? $home : $home->get($path);
        if (!($node instanceof Folder) || !$node->isReadable()) {
            throw new \InvalidArgumentException("Dossier inaccessible.");
        }
        return $node;
    }
    #[NoAdminRequired]
    public function list(string $path = ""): DataResponse
    {
        try {
            $folder = $this->folder($path);
            $items = [];
            $canSave = $folder->isCreatable();
            foreach ($folder->getDirectoryListing() as $node) {
                if (!$node->isReadable()) {
                    continue;
                }
                if (
                    $node instanceof Folder ||
                    ($node instanceof File &&
                        strtolower(
                            pathinfo($node->getName(), PATHINFO_EXTENSION),
                        ) === "pdf")
                ) {
                    if ($node instanceof File && $node->isUpdateable()) {
                        $canSave = true;
                    }
                    $items[] = [
                        "name" => $node->getName(),
                        "path" => $this->home()->getRelativePath(
                            $node->getPath(),
                        ),
                        "folder" => $node instanceof Folder,
                        "size" => $node->getSize(),
                    ];
                }
            }
            usort(
                $items,
                static fn($a, $b) => $b["folder"] <=> $a["folder"] ?:
                strnatcasecmp($a["name"], $b["name"]),
            );
            return new DataResponse([
                "items" => $items,
                "path" => "/" . $this->path($path),
                "writable" => $canSave,
            ]);
        } catch (\InvalidArgumentException $e) {
            return new DataResponse(["message" => $e->getMessage()], 400);
        } catch (\Throwable $e) {
            return new DataResponse(
                ["message" => "Impossible de lire ce dossier."],
                403,
            );
        }
    }
    private function fileById(int $fileId): File
    {
        if ($fileId < 1) {
            throw new \InvalidArgumentException(
                "Identifiant de fichier invalide.",
            );
        }
        $home = $this->home();
        foreach ($home->getById($fileId) as $node) {
            if (
                $node instanceof File &&
                $node->isReadable() &&
                $home->getRelativePath($node->getPath()) !== null &&
                strtolower(pathinfo($node->getName(), PATHINFO_EXTENSION)) ===
                    "pdf"
            ) {
                return $node;
            }
        }
        throw new \RuntimeException("PDF introuvable ou inaccessible.");
    }
    #[NoAdminRequired]
    public function source(int $fileId = 0): DataResponse
    {
        try {
            $file = $this->fileById($fileId);
            if ($file->getSize() > self::MAX_BYTES) {
                return new DataResponse(
                    ["message" => "PDF trop volumineux (50 Mio maximum)."],
                    413,
                );
            }
            return new DataResponse([
                "name" => $file->getName(),
                "path" => $this->home()->getRelativePath($file->getPath()),
                "size" => $file->getSize(),
            ]);
        } catch (\Throwable $e) {
            return new DataResponse(
                [
                    "message" =>
                        "Ce PDF est introuvable ou vous ne pouvez pas le lire.",
                ],
                404,
            );
        }
    }
    #[NoAdminRequired]
    public function read(
        string $path = "",
        int $fileId = 0,
    ): DataResponse|DataDownloadResponse {
        try {
            $file =
                $fileId > 0
                    ? $this->fileById($fileId)
                    : $this->home()->get($this->path($path));
            if (
                !($file instanceof File) ||
                !$file->isReadable() ||
                strtolower(pathinfo($file->getName(), PATHINFO_EXTENSION)) !==
                    "pdf"
            ) {
                return new DataResponse(
                    ["message" => "PDF inaccessible."],
                    403,
                );
            }
            if ($file->getSize() > self::MAX_BYTES) {
                return new DataResponse(
                    ["message" => "PDF trop volumineux (50 Mio maximum)."],
                    413,
                );
            }
            $content = $file->getContent();
            if (!str_starts_with($content, "%PDF-")) {
                return new DataResponse(
                    ["message" => "Ce fichier ne contient pas un PDF valide."],
                    422,
                );
            }
            $response = new DataDownloadResponse(
                $content,
                $file->getName(),
                "application/pdf",
            );
            $response->addHeader("Cache-Control", "no-store");
            return $response;
        } catch (\Throwable $e) {
            return new DataResponse(
                ["message" => "Impossible de lire ce PDF."],
                403,
            );
        }
    }
    #[NoAdminRequired]
    public function save(
        string $folder = "",
        string $name = "Document.pdf",
        bool $overwrite = false,
        string $expectedEtag = "",
        int $expectedId = 0,
    ): DataResponse {
        try {
            if (
                $name !== trim($name) ||
                strlen($name) > 180 ||
                preg_match('~[\\\\/:*?"<>|\x00-\x1f]~', $name) ||
                !preg_match('/^.+\.pdf$/i', $name)
            ) {
                return new DataResponse(
                    [
                        "message" =>
                            "Choisissez un nom de fichier valide terminé par .pdf.",
                    ],
                    400,
                );
            }
            $destination = $this->folder($folder);
            $existing = null;
            if ($destination->nodeExists($name)) {
                $existing = $destination->get($name);
                if (!($existing instanceof File)) {
                    return new DataResponse(
                        [
                            "message" =>
                                "Ce nom est utilisé par un dossier. Choisissez un autre nom.",
                        ],
                        409,
                    );
                }
                if (!$existing->isUpdateable()) {
                    return new DataResponse(
                        [
                            "message" =>
                                "Vous ne disposez pas du droit de modifier ce fichier.",
                        ],
                        403,
                    );
                }
                if (
                    !$overwrite ||
                    $expectedEtag === "" ||
                    $expectedId !== $existing->getId() ||
                    $expectedEtag !== $existing->getEtag()
                ) {
                    return new DataResponse(
                        [
                            "code" => $overwrite
                                ? "file_changed"
                                : "file_exists",
                            "message" => $overwrite
                                ? "Le fichier a changé depuis votre confirmation. Voulez-vous remplacer sa version actuelle ?"
                                : "Ce fichier existe déjà. Voulez-vous le remplacer ?",
                            "etag" => $existing->getEtag(),
                            "id" => $existing->getId(),
                        ],
                        409,
                    );
                }
            } elseif ($overwrite) {
                return new DataResponse(
                    [
                        "message" =>
                            "Le fichier à remplacer a été déplacé ou supprimé. Relancez l’enregistrement.",
                    ],
                    409,
                );
            } elseif (!$destination->isCreatable()) {
                return new DataResponse(
                    [
                        "message" =>
                            "Vous ne pouvez pas créer de fichier dans ce dossier.",
                    ],
                    403,
                );
            }
            $upload = $this->request->getUploadedFile("pdf");
            if (!$upload || $upload["error"] !== UPLOAD_ERR_OK) {
                return new DataResponse(
                    [
                        "message" =>
                            "Envoi incomplet. Vérifiez les limites de téléversement du serveur.",
                    ],
                    400,
                );
            }
            $size = filesize($upload["tmp_name"]);
            if ($size === false || $size < 8 || $size > self::MAX_BYTES) {
                return new DataResponse(
                    [
                        "message" =>
                            "Le PDF doit faire entre 8 octets et 50 Mio.",
                    ],
                    413,
                );
            }
            $content = file_get_contents($upload["tmp_name"]);
            if (
                $content === false ||
                !str_starts_with($content, "%PDF-") ||
                !str_contains(substr($content, -2048), "%%EOF")
            ) {
                return new DataResponse(
                    ["message" => "PDF invalide ou incomplet."],
                    422,
                );
            }
            if ($existing !== null) {
                // Native update preserves the file identity and triggers Nextcloud write hooks.
                $existing->putContent($content);
                $file = $existing;
            } else {
                $file = $destination->newFile($name, $content);
            }
            return new DataResponse(
                [
                    "path" => $this->home()->getRelativePath($file->getPath()),
                    "id" => $file->getId(),
                    "overwritten" => $existing !== null,
                ],
                $existing !== null ? 200 : 201,
            );
        } catch (\InvalidArgumentException $e) {
            return new DataResponse(["message" => $e->getMessage()], 400);
        } catch (\Throwable $e) {
            return new DataResponse(
                [
                    "message" =>
                        "Enregistrement impossible. Vérifiez les droits, le quota et la disponibilité du stockage.",
                ],
                403,
            );
        }
    }
}
