<?php
declare(strict_types=1);
namespace OCA\MJMSPDFManager\AppInfo;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Util;
class Application extends App implements IBootstrap
{
    public const APP_ID = "mjms_pdf_manager";
    public function __construct(array $urlParams = [])
    {
        parent::__construct(self::APP_ID, $urlParams);
    }
    public function register(IRegistrationContext $context): void {}
    public function boot(IBootContext $context): void
    {
        // Register before Files initializes its menus. Does not replace the default viewer.
        Util::addInitScript(self::APP_ID, "files");
    }
}
