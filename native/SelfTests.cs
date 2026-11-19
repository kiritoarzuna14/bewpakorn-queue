using System;
using System.IO;
using System.Threading;
using System.Collections.Generic;
internal static partial class Host {
 static void ResumeSelfTests(){
  var folder=Path.Combine(Path.GetTempPath(),"bewqueue-resume-"+NewId());Directory.CreateDirectory(folder);var oldPath=ledgerPath;var oldLedger=ledger;var oldAccounts=readSavedAccounts;var oldValidator=validateSavedSession;
  try{readSavedAccounts=()=>new object[]{Obj("UserID","999","Username","Operator")};validateSavedSession=(a,id)=>null;ledgerPath=Path.Combine(folder,"ledger.json");ledger=Obj("revision",0,"current",null,"handled",new object[0],"commands",new Dictionary<string,object>());
   var job=TestJob("resume");D(job["order"])["operatorUserId"]="";string jobId=S(job,"jobId"),token=S(job,"completionToken");Block(jobId,"1","LOGIN_FORM_TIMEOUT");LoadLedger();job=D(ledger["current"]);Require(S(D(job["customer"]),"canResume")=="True","TEST");
   ResumeUnsubmitted(Obj("jobId",jobId,"generation",1));job=D(ledger["current"]);Require(S(job,"jobId")==jobId && S(job,"generation")=="2" && S(job,"completionToken")!=token && S(D(job["order"]),"orderId")=="resume" && S(D(job["customer"]),"state")=="waiting" && A(ledger["handled"]).Length==0,"TEST");
   try{ResumeUnsubmitted(Obj("jobId",jobId,"generation",2));throw new Exception();}catch(HostError e){Require(e.Code=="RESUME_NOT_ALLOWED","TEST");}
   D(job["customer"])["canResume"]=true;D(job["customer"])["submissionAttempted"]=true;ResumeUnsubmitted(Obj("jobId",jobId,"generation",job["generation"]));job=D(ledger["current"]);Require(S(D(job["customer"]),"state")=="waiting" && S(D(job["customer"]),"canResume")=="False","TEST");
   D(job["customer"])["canResume"]=true;D(job["customer"])["submissionAttempted"]=false;job["importIntent"]=Obj("userId","123");try{ResumeUnsubmitted(Obj("jobId",jobId,"generation",job["generation"]));throw new Exception();}catch(HostError e){Require(e.Code=="RESUME_NOT_ALLOWED","TEST");}
   job.Remove("importIntent");D(job["customer"])["state"]="preparing";Block(jobId,S(job,"generation"),"RAM_IMPORT_FAILED");job=D(ledger["current"]);Require(S(D(job["customer"]),"canResume")=="False","TEST");
  }finally{readSavedAccounts=oldAccounts;validateSavedSession=oldValidator;ledgerPath=oldPath;ledger=oldLedger;var absolute=Path.GetFullPath(folder);var temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;Require(absolute.StartsWith(temp,StringComparison.OrdinalIgnoreCase) && Path.GetFileName(absolute).StartsWith("bewqueue-resume-"),"TEST_PATH");Directory.Delete(absolute,true);}
 }
 static Dictionary<string,object> TestJob(string orderId){var order=Obj("shopId","bewpakorn.rdcw.xyz","orderId",orderId,"productId","p","productName","P","mapId","m","mapName","M","placeId","1","operatorUserId","999","createdAt","2026-01-01T00:00:00Z","customerUsername","Customer");var job=Obj("jobId",NewId(),"generation",1,"completionToken",NewId(),"order",order,"protectedOperatorUserIds",new object[]{"999"},"state","preparing","customer",Obj("source","order","username","Customer","state","preparing"),"operator",Obj("userId","999","state","ready"));ledger["current"]=job;return job;}
 static Dictionary<string,object> TestComplete(Dictionary<string,object> job){return Obj("commandId",NewId(),"jobId",job["jobId"],"orderId",D(job["order"])["orderId"],"generation",job["generation"],"completionToken",job["completionToken"]);}
 static void LoginSelfTests(){
  var dir=Path.Combine(Path.GetTempPath(),"bewqueue-adapter-test-"+NewId());Directory.CreateDirectory(dir);var oldPath=ledgerPath;var oldLedger=ledger;var oldAuth=authenticate;var oldImport=importSession;var oldRead=persistedAccount;var oldReceiver=receiverIdentity;var oldExited=receiverExited;
  try{ledgerPath=Path.Combine(dir,"ledger.json");ledger=Obj("revision",0,"current",null,"handled",new object[0],"commands",new Dictionary<string,object>());
   receiverIdentity=()=>Obj("pid",10,"startTimeUtcTicks","100");receiverExited=i=>false;int imports=0;authenticate=c=>Obj("id","123","name","Customer");importSession=c=>{Interlocked.Increment(ref imports);return Obj("protocolVersion",2,"imported",true,"canClearBrowserSession",true);};persistedAccount=id=>Obj("UserID",id,"SecurityToken","fixture-cookie");
   var job=TestJob("good");FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"state")=="ready" && imports==1,"TEST");Require(!File.ReadAllText(ledgerPath).Contains("fixture-cookie"),"TEST");
   job=TestJob("mismatch");FinishLogin(S(job,"jobId"),S(job,"generation"),"Different","fixture-cookie");Require(S(D(job["customer"]),"code")=="CUSTOMER_ID_MISMATCH" && imports==1,"TEST");
   job=TestJob("conflict");D(job["operator"])["userId"]="123";job["protectedOperatorUserIds"]=new object[]{"999","123"};FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"code")=="ROLE_CONFLICT" && imports==1,"TEST");
   job=TestJob("selected-operator-conflict");D(job["operator"])["userId"]="123";FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"code")=="ROLE_CONFLICT" && imports==1,"TEST");
   job=TestJob("ram-source-fence");D(job["customer"])["source"]="ram";FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(imports==1 && S(D(job["customer"]),"state")=="preparing","TEST");
   job=TestJob("challenge");Block(S(job,"jobId"),S(job,"generation"),"CUSTOMER_OTP_REQUIRED");Require(S(job,"state")=="blocked" && S(job,"code")=="CUSTOMER_OTP_REQUIRED" && S(D(job["customer"]),"code")=="CUSTOMER_OTP_REQUIRED","TEST");D(job["customer"])["state"]="preparing";FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"state")=="ready" && S(job,"state")=="ready" && !job.ContainsKey("code"),"TEST");
   job=TestJob("badack");importSession=c=>Obj("protocolVersion",2,"imported",false,"canClearBrowserSession",false);FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"code")=="RAM_IMPORT_UNCERTAIN","TEST");
   job=TestJob("badpersist");importSession=c=>Obj("protocolVersion",2,"imported",true,"canClearBrowserSession",true);persistedAccount=id=>Obj("UserID",id,"SecurityToken","wrong");FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"code")=="RAM_IMPORT_UNCERTAIN","TEST");
   job=TestJob("uncertain");bool durable=false;var lateCommit=new ManualResetEvent(false);var allowCommit=new ManualResetEvent(false);authenticate=c=>Obj("id","123","name","Customer");persistedAccount=id=>durable?Obj("UserID",id,"SecurityToken","fixture-cookie"):null;importSession=c=>{var late=new Thread(()=>{allowCommit.WaitOne(5000);durable=true;lateCommit.Set();});late.Start();throw new TimeoutException();};var uncertain=job;FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");Require(S(D(job["customer"]),"code")=="RAM_IMPORT_UNCERTAIN","TEST");try{lock(Gate){Complete(TestComplete(job));}throw new Exception();}catch(HostError e){Require(e.Code=="RAM_IMPORT_UNCERTAIN","TEST");}allowCommit.Set();Require(lateCommit.WaitOne(5000),"TEST");lock(Gate){Complete(TestComplete(uncertain));}Require(ledger["current"]==null,"TEST");
   job=TestJob("deadreceiver");persistedAccount=id=>null;int uncertainAttempts=0;importSession=c=>{Interlocked.Increment(ref uncertainAttempts);throw new TimeoutException();};FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","fixture-cookie");FinishLogin(S(job,"jobId"),S(job,"generation"),"Customer","second-fixture-cookie");Require(uncertainAttempts==1,"TEST");receiverExited=i=>true;lock(Gate){Complete(TestComplete(job));}Require(ledger["current"]==null,"TEST");receiverExited=i=>false;
   job=TestJob("snapshot");var detached=Snapshot();D(D(detached["current"])["customer"])["username"]="changed";Require(S(D(job["customer"]),"username")=="Customer","TEST");Exception snapshotError=null;var changing=new Thread(()=>{try{for(int i=0;i<100;i++)lock(Gate){D(job["customer"])["counter"]=i;}}catch(Exception ex){snapshotError=ex;}});changing.Start();for(int i=0;i<100;i++){var snap=Snapshot();J.Serialize(snap);}Require(changing.Join(5000) && snapshotError==null,"TEST");
   job=TestJob("cancel");var authEntered=new ManualResetEvent(false);var releaseAuth=new ManualResetEvent(false);int lateImports=0;authenticate=c=>{authEntered.Set();Require(releaseAuth.WaitOne(5000),"TEST");return Obj("id","123","name","Customer");};importSession=c=>{Interlocked.Increment(ref lateImports);return Obj("protocolVersion",2,"imported",true,"canClearBrowserSession",true);};var old=job;var t=new Thread(()=>FinishLogin(S(old,"jobId"),S(old,"generation"),"Customer","fixture-cookie"));t.Start();Require(authEntered.WaitOne(5000),"TEST");lock(Gate){Complete(TestComplete(old));}releaseAuth.Set();Require(t.Join(5000) && lateImports==0,"TEST");
   job=TestJob("settle");var entered=new ManualResetEvent(false);var release=new ManualResetEvent(false);authenticate=c=>Obj("id","123","name","Customer");persistedAccount=id=>Obj("UserID",id,"SecurityToken","fixture-cookie");importSession=c=>{entered.Set();Require(release.WaitOne(5000),"TEST");return Obj("protocolVersion",2,"imported",true,"canClearBrowserSession",true);};var settling=job;var worker=new Thread(()=>FinishLogin(S(settling,"jobId"),S(settling,"generation"),"Customer","fixture-cookie"));worker.Start();Require(entered.WaitOne(5000),"TEST");var completed=new ManualResetEvent(false);var completer=new Thread(()=>{lock(Gate){Complete(TestComplete(settling));}completed.Set();});completer.Start();Require(!completed.WaitOne(100),"TEST");release.Set();Require(worker.Join(5000) && completed.WaitOne(5000) && completer.Join(5000),"TEST");Require(ledger["current"]==null,"TEST");var next=TestJob("next");Require(S(D(next["customer"]),"state")=="preparing","TEST");
     }finally{authenticate=oldAuth;importSession=oldImport;persistedAccount=oldRead;receiverIdentity=oldReceiver;receiverExited=oldExited;ledger=oldLedger;ledgerPath=oldPath;Directory.Delete(dir,true);}
 }
 static void BrowserLoginAndLaunchSelfTests(){
  var dir=Path.Combine(Path.GetTempPath(),"bewqueue-browser-launch-"+NewId());Directory.CreateDirectory(dir);
  var oldPath=ledgerPath;var oldLedger=ledger;var oldAuth=authenticate;var oldImport=importSession;var oldRead=persistedAccount;var oldReceiver=receiverIdentity;var oldExited=receiverExited;var oldAccounts=readSavedAccounts;var oldLaunch=customerLaunchServices;var oldBaselineKey=browserBaselineKey;var oldBaselineFp=browserBaselineFingerprint;var oldActiveKey=activeCustomerLaunchKey;
  try{
   ledgerPath=Path.Combine(dir,"ledger.json");ledger=Obj("revision",0,"current",null,"handled",new object[0],"commands",new Dictionary<string,object>());
   var launchedUris=new List<string>();
   string vipUrl="https://www.roblox.com/games/132929771812494?privateServerLinkCode=TESTLINKCODE99";
   object[] ramAccounts=new object[]{
    Obj("UserID","999","Username","Operator","SecurityToken","op-token","Fields",Obj("SavedPlaceId","132929771812494","SavedJobId",vipUrl)),
    Obj("UserID","555","Username","Customer","SecurityToken","old-customer-token")
   };
   readSavedAccounts=()=>ramAccounts;
   receiverIdentity=()=>Obj("pid",20,"startTimeUtcTicks","200");
   receiverExited=i=>false;
   int imports=0;
   importSession=c=>{imports++;return Obj("protocolVersion",2,"imported",true,"canClearBrowserSession",true);};
   persistedAccount=id=>Obj("UserID",id,"SecurityToken","fresh-cookie-secret");
   customerLaunchServices=new CustomerLaunchServices{
    Accounts=()=>ramAccounts,
    VerifyProtocol=()=>{},
    ResolvePrivateAccess=(cookie,place,url)=>{Require(url.Contains("TESTLINKCODE99"),"TEST");return "11111111-2222-3333-4444-555555555555";},
    FetchTicket=(cookie,place)=>"TICKET_SECRET_XYZ",
    StartProtocol=uri=>launchedUris.Add(uri),
    Now=()=>new DateTime(2026,11,20,0,0,0,DateTimeKind.Utc)
   };

   // 1. Prepare enters browser login mode without WebView or password
   var order=Obj("shopId","bewpakorn.rdcw.xyz","orderId","o-vip","productId","p","productName","P","mapId","cameraman","mapName","Cameraman","placeId","132929771812494","operatorUserId","999","createdAt","2026-01-01T00:00:00Z","customerUsername","");
   var job=Obj("jobId",NewId(),"generation",1,"completionToken",NewId(),"order",order,"protectedOperatorUserIds",new object[]{"999"},"state","preparing","customer",Obj("source","order","username","","state","waiting"),"operator",Obj("userId","999","state","ready"));
   ledger["current"]=job;
   Prepare(Obj("jobId",job["jobId"],"generation",1,"username","Customer"));
   Require(S(D(job["customer"]),"loginMode")=="browser" && S(D(job["customer"]),"state")=="preparing","TEST");

   // 2. Wrong browser account does not import or block
   authenticate=c=>Obj("id","777","name","WrongUser");
   var mismatch=ImportBrowserSession(Obj("jobId",job["jobId"],"generation",1,"username","Customer","cookie","wrong-cookie"));
   Require(S(mismatch,"matched")=="False" && S(mismatch,"code")=="CUSTOMER_ID_MISMATCH" && S(mismatch,"actualUsername")=="WrongUser" && S(mismatch,"canClearBrowserCookie")=="False" && imports==0,"TEST");
   Require(S(D(job["customer"]),"state")=="preparing","TEST");

   // 3. Matching browser session imports to RAM and auto-launches VIP private server
   authenticate=c=>Obj("id","555","name","Customer");
   var ok=ImportBrowserSession(Obj("jobId",job["jobId"],"generation",1,"username","Customer","cookie","fresh-cookie-secret"));
   Require(S(ok,"matched")=="True" && S(ok,"imported")=="True" && S(ok,"canClearBrowserCookie")=="True" && imports==1,"TEST");
   Require(S(D(job["customer"]),"state")=="ready" && S(D(D(job["customer"])["game"]),"state")=="launched" && S(D(D(job["customer"])["game"]),"mode")=="private","TEST");
   Require(launchedUris.Count==1 && launchedUris[0].Contains("RequestPrivateGame") && launchedUris[0].Contains("11111111-2222-3333-4444-555555555555") && launchedUris[0].Contains("TICKET_SECRET_XYZ"),"TEST");
   string disk=File.ReadAllText(ledgerPath);
   Require(!disk.Contains("fresh-cookie-secret") && !disk.Contains("TICKET_SECRET_XYZ") && !disk.Contains("TESTLINKCODE99") && !disk.Contains("11111111-2222-3333-4444-555555555555"),"TEST");

   // 4. Fallback to Public Server when map has no VIP link
   launchedUris.Clear();
   var orderPub=Obj("shopId","bewpakorn.rdcw.xyz","orderId","o-pub","productId","p","productName","P","mapId","other","mapName","Other","placeId","999888777","operatorUserId","999","createdAt","2026-01-01T00:00:00Z","customerUsername","");
   job=Obj("jobId",NewId(),"generation",1,"completionToken",NewId(),"order",orderPub,"protectedOperatorUserIds",new object[]{"999"},"state","preparing","customer",Obj("source","order","username","","state","waiting"),"operator",Obj("userId","999","state","ready"));
   ledger["current"]=job;
   Prepare(Obj("jobId",job["jobId"],"generation",1,"username","Customer"));
   ImportBrowserSession(Obj("jobId",job["jobId"],"generation",1,"username","Customer","cookie","fresh-cookie-secret"));
   Require(S(D(D(job["customer"])["game"]),"state")=="launched" && S(D(D(job["customer"])["game"]),"mode")=="public","TEST");
   Require(launchedUris.Count==1 && launchedUris[0].Contains("RequestGame") && launchedUris[0].Contains("999888777"),"TEST");

   // 5. VIP failure keeps customer ready and allows manual public server launch
   launchedUris.Clear();
   customerLaunchServices.ResolvePrivateAccess=(cookie,place,url)=>{throw new HostError("PRIVATE_TARGET_DENIED");};
   job=Obj("jobId",NewId(),"generation",1,"completionToken",NewId(),"order",Obj("shopId","bewpakorn.rdcw.xyz","orderId","o-vipfail","productId","p","productName","P","mapId","cameraman","mapName","Cameraman","placeId","132929771812494","operatorUserId","999","createdAt","2026-01-01T00:00:00Z","customerUsername",""),"protectedOperatorUserIds",new object[]{"999"},"state","preparing","customer",Obj("source","order","username","","state","waiting"),"operator",Obj("userId","999","state","ready"));
   ledger["current"]=job;
   Prepare(Obj("jobId",job["jobId"],"generation",1,"username","Customer"));
   ImportBrowserSession(Obj("jobId",job["jobId"],"generation",1,"username","Customer","cookie","fresh-cookie-secret"));
   Require(S(D(job["customer"]),"state")=="ready" && S(D(D(job["customer"])["game"]),"state")=="failed" && S(D(D(job["customer"])["game"]),"code")=="PRIVATE_TARGET_DENIED","TEST");
   ramAccounts=new object[]{Obj("UserID","999","Username","Operator","SecurityToken","op-token","Fields",Obj("SavedPlaceId","132929771812494","SavedJobId",vipUrl)),Obj("UserID","555","Username","Customer","SecurityToken","fresh-cookie-secret")};
   LaunchCustomerGameCommand(Obj("jobId",job["jobId"],"generation",1,"mode","public"));
   Require(S(D(D(job["customer"])["game"]),"state")=="launched" && S(D(D(job["customer"])["game"]),"mode")=="public" && launchedUris.Count==1 && launchedUris[0].Contains("RequestGame"),"TEST");

   // 6. SyncRamCustomer detects freshly imported RAM token (ChromeCookieImportExtension coexistence)
   launchedUris.Clear();
   customerLaunchServices.ResolvePrivateAccess=(cookie,place,url)=>"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
   ramAccounts=new object[]{Obj("UserID","999","Username","Operator","SecurityToken","op-token","Fields",Obj("SavedPlaceId","132929771812494","SavedJobId",vipUrl)),Obj("UserID","555","Username","Customer","SecurityToken","stale-token")};
   job=Obj("jobId",NewId(),"generation",1,"completionToken",NewId(),"order",Obj("shopId","bewpakorn.rdcw.xyz","orderId","o-sync","productId","p","productName","P","mapId","cameraman","mapName","Cameraman","placeId","132929771812494","operatorUserId","999","createdAt","2026-01-01T00:00:00Z","customerUsername",""),"protectedOperatorUserIds",new object[]{"999"},"state","preparing","customer",Obj("source","order","username","","state","waiting"),"operator",Obj("userId","999","state","ready"));
   ledger["current"]=job;
   Prepare(Obj("jobId",job["jobId"],"generation",1,"username","Customer"));
   var notYet=SyncRamCustomer(Obj("jobId",job["jobId"],"generation",1,"username","Customer"));
   Require(S(notYet,"synced")=="False","TEST");
   ramAccounts=new object[]{Obj("UserID","999","Username","Operator","SecurityToken","op-token","Fields",Obj("SavedPlaceId","132929771812494","SavedJobId",vipUrl)),Obj("UserID","555","Username","Customer","SecurityToken","brand-new-token")};
   var synced=SyncRamCustomer(Obj("jobId",job["jobId"],"generation",1,"username","Customer"));
   Require(S(synced,"synced")=="True" && S(D(job["customer"]),"state")=="ready" && S(D(D(job["customer"])["game"]),"state")=="launched" && S(D(D(job["customer"])["game"]),"mode")=="private" && launchedUris.Count==1,"TEST");
  }finally{
   authenticate=oldAuth;importSession=oldImport;persistedAccount=oldRead;receiverIdentity=oldReceiver;receiverExited=oldExited;readSavedAccounts=oldAccounts;customerLaunchServices=oldLaunch;browserBaselineKey=oldBaselineKey;browserBaselineFingerprint=oldBaselineFp;activeCustomerLaunchKey=oldActiveKey;ledger=oldLedger;ledgerPath=oldPath;
   Directory.Delete(dir,true);
  }
 }
}
