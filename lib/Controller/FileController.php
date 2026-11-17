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
        private \OCP\IL10N $l10n,
        private IRootFolder $root,
        private IUserSession $session,
    ) {
        parent::__construct("mjms_pdf_manager", $request);
    }
    private function home(): Folder
    {
        $user = $this->session->getUser();
        if ($user === null) {
            throw new \RuntimeException($this->l10n->t("Authentication required."));
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
            throw new \InvalidArgumentException($this->l10n->t("Invalid path."));
        }
        return trim($path, "/");
    }
    private function folder(string $path): Folder
    {
        $home = $this->home();
        $path = $this->path($path);
        $node = $path === "" ? $home : $home->get($path);
        if (!($node instanceof Folder) || !$node->isReadable()) {
            throw new \InvalidArgumentException($this->l10n->t("Folder inaccessible."));
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
                ["message" => $this->l10n->t("Unable to read this folder.")],
                403,
            );
        }
    }
    private function fileById(int $fileId): File
    {
        if ($fileId < 1) {
            throw new \InvalidArgumentException(
                $this->l10n->t("Invalid file ID."),
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
        throw new \RuntimeException($this->l10n->t("PDF not found or inaccessible."));
    }
    #[NoAdminRequired]
    public function source(int $fileId = 0): DataResponse
    {
        try {
            $file = $this->fileById($fileId);
            if ($file->getSize() > self::MAX_BYTES) {
                return new DataResponse(
                    ["message" => $this->l10n->t("PDF too large (50 MiB maximum).")],
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
                        $this->l10n->t("This PDF was not found or you cannot read it."),
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
                    ["message" => $this->l10n->t("PDF inaccessible.")],
                    403,
                );
            }
            if ($file->getSize() > self::MAX_BYTES) {
                return new DataResponse(
                    ["message" => $this->l10n->t("PDF too large (50 MiB maximum).")],
                    413,
                );
            }
            $content = $file->getContent();
            if (!str_starts_with($content, "%PDF-")) {
                return new DataResponse(
                    ["message" => $this->l10n->t("This file does not contain a valid PDF.")],
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
                ["message" => $this->l10n->t("Unable to read this PDF.")],
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
                            $this->l10n->t("Choose a valid filename ending in .pdf."),
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
                                $this->l10n->t("This name is used by a folder. Choose another name."),
                        ],
                        409,
                    );
                }
                if (!$existing->isUpdateable()) {
                    return new DataResponse(
                        [
                            "message" =>
                                $this->l10n->t("You do not have permission to edit this file."),
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
                                ? $this->l10n->t("The file has changed since your confirmation. Replace its current version?")
                                : $this->l10n->t("This file already exists. Replace it?"),
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
                            $this->l10n->t("The file to replace was moved or deleted. Start saving again."),
                    ],
                    409,
                );
            } elseif (!$destination->isCreatable()) {
                return new DataResponse(
                    [
                        "message" =>
                            $this->l10n->t("You cannot create files in this folder."),
                    ],
                    403,
                );
            }
            $upload = $this->request->getUploadedFile("pdf");
            if (!$upload || $upload["error"] !== UPLOAD_ERR_OK) {
                return new DataResponse(
                    [
                        "message" =>
                            $this->l10n->t("Upload incomplete. Check the server upload limits."),
                    ],
                    400,
                );
            }
            $size = filesize($upload["tmp_name"]);
            if ($size === false || $size < 8 || $size > self::MAX_BYTES) {
                return new DataResponse(
                    [
                        "message" =>
                            $this->l10n->t("The PDF must be between 8 bytes and 50 MiB."),
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
                    ["message" => $this->l10n->t("Invalid or incomplete PDF.")],
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
                        $this->l10n->t("Could not save. Check permissions, quota and storage availability."),
                ],
                403,
            );
        }
    }
}
