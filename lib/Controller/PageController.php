<?php
declare(strict_types=1);
namespace OCA\MJMSPDFManager\Controller;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\IRequest;
class PageController extends Controller
{
    public function __construct(IRequest $request)
    {
        parent::__construct("mjms_pdf_manager", $request);
    }
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function index(): TemplateResponse
    {
        $response = new TemplateResponse($this->appName, "main");
        $policy = new ContentSecurityPolicy();
        $policy->addAllowedWorkerSrcDomain("'self'");
        $policy->allowEvalWasm(true); // PDF.js image/font decoders; JavaScript eval remains disabled.
        $response->setContentSecurityPolicy($policy);
        return $response;
    }
}
