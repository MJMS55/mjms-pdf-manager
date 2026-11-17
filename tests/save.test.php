<?php
// Storage doubles: never touches a real Nextcloud instance.
namespace OCP { interface IRequest {} interface IUserSession {} }
namespace OCP\Files { interface IRootFolder {} interface Folder {} interface File {} }
namespace OCP\AppFramework { class Controller { public function __construct(protected string $appName,protected \OCP\IRequest $request){} } }
namespace OCP\AppFramework\Http {
 class DataResponse { public function __construct(public mixed $data,public int $status=200){} }
 class DataDownloadResponse { public function __construct(public string $content, public string $name, public string $mime){} public function addHeader($n,$v){} }
}
namespace OCP\AppFramework\Http\Attribute { #[\Attribute(\Attribute::TARGET_METHOD)] class NoAdminRequired {} }
namespace {
 require __DIR__.'/../lib/Controller/FileController.php';
 class PdfFile implements \OCP\Files\File {
  public string $content='original', $etag='v1'; public bool $update=true; public int $writes=0, $id=7;
  public bool $readable=true; public string $name='Document.pdf'; public int $size=100; public function isReadable(){return $this->readable;} public function getName(){return $this->name;} public function getSize(){return $this->size;} public function getContent(){return $this->content;}
  public function isUpdateable(){return $this->update;} public function getId(){return $this->id;} public function getEtag(){return $this->etag;}
  public function putContent($v){$this->content=$v;$this->etag='v2';$this->writes++;} public function getPath(){return '/user/files/Document.pdf';}
 }
 class Home implements \OCP\Files\Folder {
  public mixed $node=null;public bool $create=true;public int $created=0;
  public function isReadable(){return true;} public function isCreatable(){return $this->create;}
  public function nodeExists($n){return $this->node!==null;}public function get($n){return $this->node;}
  public function newFile($n,$v){$this->created++;$this->node=new PdfFile;$this->node->content=$v;return $this->node;}
  public bool $inside=true; public function getById($id){return $this->node instanceof PdfFile && $this->node->id===$id ? [$this->node] : [];} public function getRelativePath($p){return $this->inside ? '/Document.pdf' : null;}
 }
 class Root implements \OCP\Files\IRootFolder {public function __construct(public Home $home){} public function getUserFolder($u){return $this->home;}}
 class Session implements \OCP\IUserSession {public function getUser(){return new class { public function getUID(){return 'user';} };}}
 class Request implements \OCP\IRequest {public function __construct(public string $path){}public function getUploadedFile($n){return ['error'=>UPLOAD_ERR_OK,'tmp_name'=>$this->path];}}
 function verify($ok,$label){if(!$ok)throw new \RuntimeException($label);echo "OK: $label\n";}
 $tmp=tempnam(sys_get_temp_dir(),'mjms-save-');$bytes="%PDF-1.7\nnew content\n%%EOF";file_put_contents($tmp,$bytes);
 try {
  $home=new Home;$controller=new \OCA\MJMSPDFManager\Controller\FileController(new Request($tmp),new Root($home),new Session);
  $r=$controller->save();verify($r->status===201&&$home->created===1&&$home->node->content===$bytes,'New file created normally');
  $file=$home->node;$file->content='original';
  $r=$controller->save();verify($r->status===409&&$r->data['code']==='file_exists'&&$file->writes===0,'Existing file requires confirmation and is unchanged');
  $r=$controller->save('', 'Document.pdf',true);verify($r->status===409&&$file->writes===0,'Overwrite without version confirmation refused');
  $r=$controller->save('', 'Document.pdf',true,'old',7);verify($r->status===409&&$r->data['code']==='file_changed','Changed version requires confirmation again');
  $r=$controller->save('', 'Document.pdf',true,'v1',99);verify($r->status===409,'Different file identity refused');
  $file->update=false;$r=$controller->save('', 'Document.pdf',true,'v1',7);verify($r->status===403&&$file->writes===0,'Read-only file cannot be overwritten');$file->update=true;
  file_put_contents($tmp,'not a valid PDF');clearstatcache(true,$tmp);$r=$controller->save('', 'Document.pdf',true,'v1',7);verify($r->status===422&&$file->content==='original','Invalid upload leaves existing contents intact');file_put_contents($tmp,$bytes);clearstatcache(true,$tmp);
  $home->create=false;$r=$controller->save('', 'Document.pdf',true,'v1',7);verify($r->status===200&&$r->data['overwritten']&&$file->content===$bytes&&$file->id===7&&$home->created===1,'Confirmed update preserves file identity and only requires file update permission');
  $home->node=new Home;$r=$controller->save();verify($r->status===409&&!isset($r->data['code']),'Folder name collision cannot be overwritten');
  $home->node=null;$r=$controller->save('', 'Document.pdf',true,'v1',7);verify($r->status===409&&$home->created===1,'Deleted target is not silently recreated');
  $r=$controller->save();verify($r->status===403,'Create permission remains required for new files');
  $home->node=$file;
  $r=$controller->source(7);verify($r->status===200&&$r->data['name']==='Document.pdf','Source resolved within current user folder');
  $r=$controller->read('',7);verify($r instanceof \OCP\AppFramework\Http\DataDownloadResponse&&$r->content===$bytes,'PDF content read by file ID');
  verify($controller->source(99)->status===404,'Unknown file ID refused');
  $file->readable=false;verify($controller->source(7)->status===404,'Unreadable source refused');$file->readable=true;
  $home->inside=false;verify($controller->source(7)->status===404,'Source outside user folder refused');$home->inside=true;
  $file->name='document.txt';verify($controller->source(7)->status===404,'Non PDF source refused');$file->name='Document.pdf';
  $file->size=52428801;verify($controller->source(7)->status===413,'Oversized source refused');
 }finally{unlink($tmp);}
}

