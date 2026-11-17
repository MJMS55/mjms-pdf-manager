import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagerAction} from '../src/file-action.js';
const navigations=[];
const action=createManagerAction({generateUrl:path=>'/cloud/index.php'+path,navigate:url=>navigations.push(url),readPermission:1});
const pdf={mime:'application/pdf',fileid:42,permissions:1};
test('Files action opens readable PDF by id under a Nextcloud subdirectory',async()=>{
 assert.equal(action.enabled({nodes:[pdf]}),true);
 await action.exec({nodes:[pdf]});
 assert.equal(navigations.at(-1),'/cloud/index.php/apps/mjms_pdf_manager/?fileId=42');
});
test('Files action refuses multi-selection, inaccessible files and invalid identifiers',async()=>{
 for(const nodes of [[],[pdf,pdf],[{...pdf,permissions:0}],[{...pdf,mime:'text/plain'}],[{...pdf,fileid:-1}],[{...pdf,fileid:NaN}]]){
  assert.equal(action.enabled({nodes}),false);const count=navigations.length;
  assert.equal(await action.exec({nodes}),false);assert.equal(navigations.length,count);
 }
});
