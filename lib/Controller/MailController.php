<?php
declare(strict_types=1);
namespace OCA\MJMSPDFManager\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/** Sends only the explicitly submitted PDF, through Nextcloud's configured transport. */
class MailController extends Controller
{
    private const MAX_ATTACHMENT_BYTES = 10485760;
    public function __construct(
        IRequest $request,
        private IUserSession $session,
        private IMailer $mailer,
        private LoggerInterface $logger,
    ) {
        parent::__construct("mjms_pdf_manager", $request);
    }

    #[NoAdminRequired]
    #[UserRateLimit(limit: 5, period: 300)]
    public function send(
        string $to = "",
        string $subject = "",
        string $body = "",
        string $name = "Document.pdf",
    ): DataResponse {
        $user = $this->session->getUser();
        if ($user === null) {
            return new DataResponse(
                ["message" => "Authentification requise."],
                401,
            );
        }
        $to = trim($to);
        $subject = trim($subject);
        if (
            strlen($to) > 254 ||
            !filter_var($to, FILTER_VALIDATE_EMAIL) ||
            preg_match('/[\r\n]/', $to)
        ) {
            return new DataResponse(
                ["message" => "Saisissez une seule adresse mail valide."],
                400,
            );
        }
        if (
            $subject === "" ||
            strlen($subject) > 800 ||
            preg_match('/[\x00-\x1f\x7f]/', $subject) ||
            strlen($body) > 40000
        ) {
            return new DataResponse(
                ["message" => "Objet ou message invalide ou trop long."],
                400,
            );
        }
        if (
            $name !== trim($name) ||
            strlen($name) > 180 ||
            preg_match('~[\\\\/:*?"<>|\x00-\x1f\x7f]~', $name) ||
            !preg_match('/^.+\.pdf$/i', $name)
        ) {
            return new DataResponse(
                [
                    "message" =>
                        "Nom de pièce jointe invalide : utilisez un nom terminé par .pdf.",
                ],
                400,
            );
        }
        $upload = $this->request->getUploadedFile("pdf");
        if (
            !$upload ||
            ($upload["error"] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK ||
            !is_uploaded_file($upload["tmp_name"])
        ) {
            return new DataResponse(
                ["message" => "Pièce jointe absente ou envoi incomplet."],
                400,
            );
        }
        $size = filesize($upload["tmp_name"]);
        if (
            $size === false ||
            $size < 8 ||
            $size > self::MAX_ATTACHMENT_BYTES
        ) {
            return new DataResponse(
                [
                    "message" =>
                        "La pièce jointe doit être un PDF de 10 Mio maximum.",
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
                [
                    "message" =>
                        "La pièce jointe PDF est invalide ou incomplète.",
                ],
                422,
            );
        }
        try {
            $message = $this->mailer->createMessage();
            // No client-supplied From: Nextcloud chooses the configured server sender.
            $message->setTo([$to]);
            $message->setSubject($subject);
            $message->setPlainBody($body);
            $replyTo = $user->getEMailAddress();
            if ($replyTo && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
                $message->setReplyTo([$replyTo]);
            }
            $message->attach(
                $this->mailer->createAttachment(
                    $content,
                    $name,
                    "application/pdf",
                ),
            );
            $failed = $this->mailer->send($message);
            if ($failed !== []) {
                return new DataResponse(
                    [
                        "message" =>
                            "Le serveur de messagerie a refusé le destinataire. Vérifiez son adresse et la configuration SMTP.",
                    ],
                    502,
                );
            }
            return new DataResponse([
                "message" =>
                    "Le PDF a été remis au serveur de messagerie pour envoi à " .
                    $to .
                    ".",
            ]);
        } catch (\Throwable $e) {
            $this->logger->error("MJMS PDF: mail submission failed", [
                "app" => $this->appName,
                "exception" => $e,
            ]);
            return new DataResponse(
                [
                    "message" =>
                        "Envoi non confirmé. Vérifiez la configuration SMTP et les journaux Nextcloud avant de réessayer pour éviter un doublon.",
                ],
                502,
            );
        }
    }
}
