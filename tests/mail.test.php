<?php
// Isolated controller tests. Nextcloud transport and upload provenance are simulated.
namespace OCP { interface IL10N {} class TestL10N implements IL10N { public function t($text) { return $text; } }  interface IRequest {} interface IUserSession {} }
namespace OCP\Mail { interface IMailer {} }
namespace Psr\Log { interface LoggerInterface {} }
namespace OCP\AppFramework {
 class Controller { public function __construct(protected string $appName, protected \OCP\IRequest $request) {} }
}
namespace OCP\AppFramework\Http {
 class DataResponse { public function __construct(public mixed $data, public int $status = 200) {} }
}
namespace OCP\AppFramework\Http\Attribute {
 #[\Attribute(\Attribute::TARGET_METHOD)] class NoAdminRequired {}
 #[\Attribute(\Attribute::TARGET_METHOD)] class UserRateLimit { public function __construct(public int $limit, public int $period) {} }
}
namespace OCA\MJMSPDFManager\Controller {
 // PHP CLI cannot create HTTP uploads. Only this test harness substitutes that check.
 function is_uploaded_file(string $path): bool { return \is_file($path); }
}
namespace {
 require __DIR__ . '/../lib/Controller/MailController.php';
 class TestRequest implements \OCP\IRequest { public ?array $upload; public function getUploadedFile($key) { return $this->upload; } }
 class TestSession implements \OCP\IUserSession {
  public bool $authenticated=true;
  public function getUser() { return $this->authenticated ? new class { public function getEMailAddress(){ return 'author@example.test'; } } : null; }
 }
 class TestMessage {
  public array $to=[], $reply=[]; public string $subject='', $body=''; public mixed $attachment=null;
  public function setTo($v){$this->to=$v;} public function setSubject($v){$this->subject=$v;} public function setPlainBody($v){$this->body=$v;}
  public function setReplyTo($v){$this->reply=$v;} public function attach($v){$this->attachment=$v;}
 }
 class TestMailer implements \OCP\Mail\IMailer {
  public int $calls=0; public bool $throws=false; public array $failed=[]; public ?TestMessage $message=null;
  public function createMessage(){ return $this->message=new TestMessage; }
  public function createAttachment($content,$name,$type){ return compact('content','name','type'); }
  public function send($message){$this->calls++; if($this->throws)throw new \RuntimeException('Transport failure');return $this->failed;}
 }
 class TestLogger implements \Psr\Log\LoggerInterface { public int $errors=0; public function error($m,$c){$this->errors++;} }
 function check(bool $value,string $message){ if(!$value)throw new \RuntimeException($message); }
 $path=tempnam(sys_get_temp_dir(),'mjms-test-');
 try {
  $bytes="%PDF-1.7\nfixture\n%%EOF";file_put_contents($path,$bytes);
  $request=new TestRequest;$request->upload=['error'=>UPLOAD_ERR_OK,'tmp_name'=>$path];
  $session=new TestSession;$mailer=new TestMailer;$logger=new TestLogger;
  $controller=new \OCA\MJMSPDFManager\Controller\MailController($request,new \OCP\TestL10N,$session,$mailer,$logger);
  $response=$controller->send('reader@example.test','Votre PDF','Bonjour','Résultat.pdf');
  check($response->status===200&&$mailer->calls===1,'Successful send');
  check($mailer->message->attachment===['content'=>$bytes,'name'=>'Résultat.pdf','type'=>'application/pdf'],'Exact PDF attachment');
  check($mailer->message->to===['reader@example.test']&&$mailer->message->reply===['author@example.test'],'Recipient and Reply-To');
  check($mailer->message->subject==='Votre PDF'&&$mailer->message->body==='Bonjour','Subject/body');
  foreach([
   ['reader@example.test,other@example.test','PDF','Doc.pdf'],
   ["reader@example.test\r\nBcc: other@example.test",'PDF','Doc.pdf'],
   ['reader@example.test',"PDF\r\nInjected",'Doc.pdf'],
   ['reader@example.test','PDF','../doc.pdf'],
   ['reader@example.test','PDF','doc.txt'],
  ] as [$to,$subject,$name])check($controller->send($to,$subject,'Text',$name)->status===400,'Bad input rejected');
  check($mailer->calls===1,'Bad input must not send');
  $session->authenticated=false;check($controller->send()->status===401,'Authentication required');$session->authenticated=true;
  $request->upload=null;check($controller->send('reader@example.test','PDF')->status===400,'Missing upload');$request->upload=['error'=>UPLOAD_ERR_OK,'tmp_name'=>$path];
  file_put_contents($path,'not a valid PDF');check($controller->send('reader@example.test','PDF')->status===422,'Bad PDF rejected');
  file_put_contents($path,str_repeat('x',10485761));clearstatcache(true,$path);check($controller->send('reader@example.test','PDF')->status===413,'Size limit');
  file_put_contents($path,$bytes);clearstatcache(true,$path);
  $mailer->failed=['reader@example.test'];check($controller->send('reader@example.test','PDF')->status===502,'Rejected recipient');
  $mailer->failed=[];$mailer->throws=true;check($controller->send('reader@example.test','PDF')->status===502&&$logger->errors===1,'Transport failure');
  $method=new \ReflectionMethod($controller,'send');$limit=$method->getAttributes(\OCP\AppFramework\Http\Attribute\UserRateLimit::class)[0]->newInstance();
  check($limit->limit===5&&$limit->period===300,'Rate limit declared');
  echo "Mail controller: all 15 scenarios passed; no real email sent.\n";
 } finally {unlink($path);}
}
