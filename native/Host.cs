using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static partial class Host {
 const int RequestLimit=262144, ResponseLimit=1048576, LedgerLimit=8388608, RamLimit=16777216;
 static readonly ThreadLocal<JavaScriptSerializer> Json = new ThreadLocal<JavaScriptSerializer>(()=>new JavaScriptSerializer { MaxJsonLength=RamLimit, RecursionLimit=32 });
 static JavaScriptSerializer J { get { return Json.Value; } }
 static readonly object Gate = new object(); static bool selfTesting,hostStopping;
 static Stream eventOutput; static readonly object OutputGate=new object(); static string ledgerPath, ramPath, ramExePath; static Dictionary<string,object> ledger; static Mutex mutex;
 static Dictionary<string,object> D(object o) { return o as Dictionary<string,object>; }
 static string S(Dictionary<string,object> d,string k) { object v; return d!=null && d.TryGetValue(k,out v) && v!=null ? Convert.ToString(v) : ""; }
 static Dictionary<string,object> Obj(params object[] p) { var d=new Dictionary<string,object>(); for(int i=0;i<p.Length;i+=2)d[(string)p[i]]=p[i+1]; return d; }
 static object[] A(object o) { var a=o as object[]; if(a!=null)return a; var l=o as ArrayList; return l==null?new object[0]:l.ToArray(); }
 static string NewId(){ return Guid.NewGuid().ToString("N"); }
 static string Now(){return DateTime.UtcNow.ToString("o");}
 static string ErrorCode(Exception e){ var x=e as HostError; return x==null?"NATIVE_ERROR":x.Code; }
 sealed class HostError:Exception { public string Code; public HostError(string s){Code=s;} }
 static void Require(bool value,string code){if(!value)throw new HostError(code);}
 static void Init(string baseDir, string origin) {
  var cfgPath=Path.Combine(baseDir,"config.json"); Require(File.Exists(cfgPath),"CONFIG_REQUIRED");
  var cfg=D(J.DeserializeObject(File.ReadAllText(cfgPath))); Require(cfg!=null,"CONFIG_INVALID");
  string expected=S(cfg,"extensionOrigin"); Require(System.Text.RegularExpressions.Regex.IsMatch(expected,@"^chrome-extension://[a-p]{32}/$"),"CONFIG_INVALID");
  Require(String.Equals(origin,expected,StringComparison.Ordinal),"ORIGIN_DENIED");
  string ramDirectory=Environment.ExpandEnvironmentVariables(S(cfg,"ramDirectory")); string folder=Environment.ExpandEnvironmentVariables(S(cfg,"dataDirectory")); Require(Path.IsPathRooted(ramDirectory) && Path.IsPathRooted(folder),"CONFIG_INVALID"); ramPath=Path.Combine(ramDirectory,"AccountData.json"); ramExePath=Path.GetFullPath(Path.Combine(ramDirectory,"Bewpakorn RAM.exe"));
  Directory.CreateDirectory(folder); ledgerPath=Path.Combine(folder,"ledger.json");
  bool created; mutex=new Mutex(true,@"Local\BewpakornQueue.NativeHost.v1",out created); Require(created,"HOST_BUSY");
  profilesRoot=Path.Combine(folder,"profiles"); CleanProfiles(); LoadLedger();
 }
 static void LoadLedger(){
  if(!File.Exists(ledgerPath)){ledger=Obj("revision",0,"current",null,"handled",new object[0],"commands",new Dictionary<string,object>());return;}
  try {var f=new FileInfo(ledgerPath); Require(f.Length>0 && f.Length<=LedgerLimit,"LEDGER_CORRUPT"); ledger=D(J.DeserializeObject(File.ReadAllText(ledgerPath,Encoding.UTF8))); Require(ledger!=null && ledger.ContainsKey("revision") && ledger.ContainsKey("current") && ledger.ContainsKey("handled") && D(ledger["commands"])!=null,"LEDGER_CORRUPT");
   var job=D(ledger["current"]); if(job!=null){job.Remove("launchPair");var customer=D(job.ContainsKey("customer")?job["customer"]:null);if(customer!=null){customer.Remove("game");if(String.IsNullOrEmpty(S(customer,"source")))customer["source"]="order";if(S(customer,"source")=="ram")RestoreSavedCustomer(job);else if(S(customer,"state")!="ready"){bool uncertain=job.ContainsKey("importIntent");customer["state"]="blocked";if(!uncertain&&!RetryableLogin(S(customer,"code")))customer["code"]="CUSTOMER_LOGIN_CLOSED";customer["canResume"]=!uncertain&&RetryableLogin(S(customer,"code"));}}RestoreDefaultOperator(job);UpdateJobState(job);Bump(); Save(); }
  } catch(HostError){throw;} catch {throw new HostError("LEDGER_CORRUPT");}
 }
 static void Bump(){ledger["revision"]=Convert.ToInt64(ledger["revision"])+1;}
 static void Save(){try{string data=J.Serialize(ledger); Require(Encoding.UTF8.GetByteCount(data)<=LedgerLimit,"LEDGER_FULL"); string tmp=ledgerPath+"."+NewId()+".tmp"; try { using(var f=new FileStream(tmp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){var b=new UTF8Encoding(false).GetBytes(data);f.Write(b,0,b.Length);f.Flush(true);} if(File.Exists(ledgerPath))File.Replace(tmp,ledgerPath,ledgerPath+".bak",true);else File.Move(tmp,ledgerPath); } finally {if(File.Exists(tmp))File.Delete(tmp);} if(eventOutput!=null)WriteFrame(eventOutput,Obj("v",1,"type","SNAPSHOT","payload",Snapshot())); }catch {Environment.Exit(1);throw;} }
 static Dictionary<string,object> Snapshot(){lock(Gate){var current=D(ledger["current"]);var visible=current==null?null:new Dictionary<string,object>(current);if(visible!=null)visible.Remove("importIntent");var handled=A(ledger["handled"]);var last=handled.Length==0?null:D(handled[handled.Length-1]);var target=last==null?null:Obj("shopId",S(last,"shopId"),"orderId",S(last,"orderId"),"needsRestoreOrder",D(last.ContainsKey("order")?last["order"]:null)==null);return D(J.DeserializeObject(J.Serialize(Obj("revision",ledger["revision"],"current",visible,"handled",handled,"canUndo",last!=null,"historyTarget",target))));}}
 static object[] ReadAccounts(){
  for(int attempt=0;attempt<3;attempt++) try {
   byte[] raw; using(var f=new FileStream(ramPath,FileMode.Open,FileAccess.Read,FileShare.ReadWrite)){Require(f.Length>0 && f.Length<=RamLimit,"RAM_DATABASE_INVALID"); raw=new byte[(int)f.Length]; int n=0; while(n<raw.Length){int x=f.Read(raw,n,raw.Length-n);if(x==0)break;n+=x;}Require(n==raw.Length,"RAM_DATABASE_INVALID");}
   byte[] clear; try{clear=ProtectedData.Unprotect(raw,Encoding.ASCII.GetBytes("ROBLOX ACCOUNT MANAGER | :) | BROUGHT TO YOU BUY ic3w0lf"),DataProtectionScope.CurrentUser);}catch(CryptographicException){throw new HostError("RAM_DATABASE_LOCKED");}
   try {var parsed=J.DeserializeObject(Encoding.UTF8.GetString(clear)); Require(parsed is object[],"RAM_DATABASE_INVALID");return (object[])parsed;} finally {Array.Clear(clear,0,clear.Length);}
  }catch(HostError e){if(e.Code=="RAM_DATABASE_LOCKED")throw; if(attempt==2)throw;Thread.Sleep(100);}catch {if(attempt==2)throw new HostError("RAM_DATABASE_UNAVAILABLE");Thread.Sleep(100);} throw new HostError("RAM_DATABASE_UNAVAILABLE");
 }
 static Dictionary<string,object> FindAccount(object[] accounts,string id){return accounts.Select(D).FirstOrDefault(a=>a!=null && S(a,"UserID")==id);}
 static object[] Metadata(){return readSavedAccounts().Select(D).Where(a=>a!=null).Select(a=>(object)Obj("userId",S(a,"UserID"),"username",S(a,"Username"),"alias",S(a,"Alias"),"description",S(a,"Description"),"group",S(a,"Group"))).ToArray();}
 static string ValidateOperator(Dictionary<string,object> account,string id){
  if(account==null)return "OPERATOR_NOT_MAPPED"; string cookie=S(account,"SecurityToken"); if(String.IsNullOrWhiteSpace(cookie))return "OPERATOR_SESSION_INVALID";
  try {var req=(HttpWebRequest)WebRequest.Create("https://users.roblox.com/v1/users/authenticated");req.AllowAutoRedirect=false;req.Timeout=8000;req.ReadWriteTimeout=8000;req.Headers[HttpRequestHeader.Cookie]=".ROBLOSECURITY="+cookie; using(var resp=(HttpWebResponse)req.GetResponse())using(var reader=new StreamReader(resp.GetResponseStream())) {var response=D(J.DeserializeObject(reader.ReadToEnd()));return S(response,"id")==id?null:"OPERATOR_ID_MISMATCH";}}
  catch(WebException e){var r=e.Response as HttpWebResponse;if(r!=null){if(r.StatusCode==HttpStatusCode.Unauthorized)return "OPERATOR_SESSION_INVALID";if(r.StatusCode==HttpStatusCode.Forbidden)return "ROBLOX_DENIED";}return "OPERATOR_VALIDATION_UNAVAILABLE";}catch{return "OPERATOR_VALIDATION_UNAVAILABLE";}
 }
 static Dictionary<string,object> Claim(Dictionary<string,object> p){
  var order=CleanOrder(D(p!=null && p.ContainsKey("order")?p["order"]:null)); Require(p!=null && p.ContainsKey("protectedOperatorUserIds") && p["protectedOperatorUserIds"] is object[],"INVALID_ORDER");var protectedIds=ProtectedIds(p["protectedOperatorUserIds"]);
  string oid=S(order,"orderId"); var current=D(ledger["current"]); if(current!=null){var old=D(current["order"]);Require(S(old,"orderId")==oid && S(old,"shopId")==S(order,"shopId"),"CURRENT_JOB_EXISTS");return Snapshot();}
  Require(!A(ledger["handled"]).Select(D).Any(h=>S(h,"shopId")==S(order,"shopId") && S(h,"orderId")==oid),"ORDER_ALREADY_HANDLED");
  foreach(var id in ReadOperatorPool(order))protectedIds.Add(id);
  var job=NewOrderJob(order,protectedIds.ToArray());
  ledger["current"]=job;Bump();Save();return Snapshot();
 }
 static Dictionary<string,object> ResumeUnsubmitted(Dictionary<string,object> p){
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(p,"jobId") && S(job,"generation")==S(p,"generation"),"STALE_JOB");var role=D(job["customer"]);
  Require(S(role,"canResume")=="True" && !job.ContainsKey("importIntent") && S(role,"state")!="ready","RESUME_NOT_ALLOWED");
  job["generation"]=Convert.ToInt64(job["generation"])+1;job["completionToken"]=NewId();role["state"]="waiting";role["canResume"]=false;role.Remove("code");CloseLogin();UpdateJobState(job);Bump();Save();return Snapshot();
 }
 static Dictionary<string,object> Complete(Dictionary<string,object> p){
  Require(p!=null,"INVALID_REQUEST");string command=S(p,"commandId");Require(command.Length>0 && command.Length<=128,"INVALID_REQUEST");var commands=D(ledger["commands"]); if(commands.ContainsKey(command)){Require((String.IsNullOrEmpty(S(D(commands[command]),"type")) || S(D(commands[command]),"type")=="COMPLETE_CURRENT") && S(D(commands[command]),"jobId")==S(p,"jobId") && S(D(commands[command]),"orderId")==S(p,"orderId") && S(D(commands[command]),"generation")==S(p,"generation") && S(D(commands[command]),"completionToken")==S(p,"completionToken"),"STALE_COMPLETION");return Snapshot();}
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(p,"jobId") && S(job,"generation")==S(p,"generation") && S(job,"completionToken")==S(p,"completionToken") && S(D(job["order"]),"orderId")==S(p,"orderId"),"STALE_COMPLETION");
  if(job.ContainsKey("importIntent")){Require(SettleIntent(job),"RAM_IMPORT_UNCERTAIN");job.Remove("importIntent");}CloseLogin();var list=A(ledger["handled"]).ToList();var order=D(job["order"]);list.Add(Obj("shopId",S(order,"shopId"),"orderId",S(order,"orderId"),"completedAt",Now(),"workflowCategory","ลูกค้าจากออเดอร์","operatorUserId",S(order,"operatorUserId"),"order",order,"protectedOperatorUserIds",A(job["protectedOperatorUserIds"])));ledger["handled"]=list.ToArray();commands[command]=Obj("type","COMPLETE_CURRENT","jobId",S(p,"jobId"),"orderId",S(p,"orderId"),"generation",S(p,"generation"),"completionToken",S(p,"completionToken"));  ledger["current"]=null;Bump();Save();return Snapshot();
 }
 static object Dispatch(string type,Dictionary<string,object> p){switch(type){
  case "GET_CAPABILITIES":return Obj("protocolVersion",1,"version","1.4.0","webViewAvailable",WebViewAvailable(),"ramImportSupported",true,"customerGrouping",false,"groupPolicy","default-preserve-existing","undoLast",true,"loginOnly",true,"chromeFirstLogin",true,"chromeAvailable",ChromeAvailable(),"accountSelection",true,"dualClientLaunch",false);
  case "GET_ACCOUNT_METADATA":return Obj("accounts",Metadata());
  case "GET_SNAPSHOT":return Snapshot();
  case "CLAIM_ORDER":return Claim(p);
  case "COMPLETE_CURRENT":return Complete(p);
  case "PREPARE_CUSTOMER": return Prepare(p);
  case "RESUME_UNSUBMITTED":return ResumeUnsubmitted(p);
  case "UNDO_LAST":return UndoLast(p);
  case "SELECT_ACCOUNT":return SelectAccount(p);
  default:throw new HostError("UNKNOWN_COMMAND");}}
 static byte[] ReadFrame(Stream s){byte[] header=new byte[4];int first=s.ReadByte();if(first<0)return null;header[0]=(byte)first;for(int i=1;i<4;i++){int c=s.ReadByte();if(c<0)throw new EndOfStreamException();header[i]=(byte)c;}uint n=BitConverter.ToUInt32(header,0);if(n==0 || n>RequestLimit)throw new InvalidDataException();var b=new byte[n];int off=0;while(off<b.Length){int x=s.Read(b,off,b.Length-off);if(x==0)throw new EndOfStreamException();off+=x;}return b;}
 static void WriteFrame(Stream s,object value){lock(OutputGate){byte[] b=Encoding.UTF8.GetBytes(J.Serialize(value));if(b.Length>ResponseLimit)throw new InvalidDataException();byte[] h=BitConverter.GetBytes((uint)b.Length);s.Write(h,0,4);s.Write(b,0,b.Length);s.Flush();}}
 static int Main(string[] args){ServicePointManager.SecurityProtocol=(SecurityProtocolType)3072;if(args.Length==1 && args[0]=="--self-test")return SelfTest();try{Require(args.Length>=1,"ORIGIN_DENIED");Init(AppDomain.CurrentDomain.BaseDirectory,args[0]);var input=Console.OpenStandardInput();var output=Console.OpenStandardOutput();eventOutput=output;while(true){var bytes=ReadFrame(input);if(bytes==null)break;Dictionary<string,object> request=null;object id=null;try{request=D(J.DeserializeObject(new UTF8Encoding(false,true).GetString(bytes)));Require(request!=null,"INVALID_REQUEST");id=request.ContainsKey("id")?request["id"]:null;Require(id is string && ((string)id).Length>0 && ((string)id).Length<=128 && S(request,"v")=="1","INVALID_REQUEST");object payload;lock(Gate){payload=Dispatch(S(request,"type"),D(request.ContainsKey("payload")?request["payload"]:null));}WriteFrame(output,Obj("v",1,"id",id,"type","RESULT","ok",true,"payload",payload));}catch(Exception e){WriteFrame(output,Obj("v",1,"id",id,"type","RESULT","ok",false,"error",Obj("code",ErrorCode(e))));}finally{Array.Clear(bytes,0,bytes.Length);}}return 0;}catch{return 1;}finally{lock(Gate){hostStopping=true;eventOutput=null;}try{ShutdownChromeLogins();}catch{}CloseLogin();if(mutex!=null)mutex.Dispose();}}
 static int SelfTest(){selfTesting=true;try{ChromeLoginSelfTests();PoolSelfTests();LoginSelfTests();ResumeSelfTests();SelectionNavigationSelfTests();using(var m=new MemoryStream()){WriteFrame(m,Obj("x","ทดสอบ"));m.Position=0;Require(D(J.DeserializeObject(Encoding.UTF8.GetString(ReadFrame(m))))!=null,"TEST");} var dir=Path.Combine(Path.GetTempPath(),"bewqueue-test-"+NewId());Directory.CreateDirectory(dir);try{ledgerPath=Path.Combine(dir,"ledger.json");ledger=Obj("revision",0,"current",null,"handled",new object[0],"commands",new Dictionary<string,object>());var order=Obj("shopId","bewpakorn.rdcw.xyz","orderId","one","productId","p","productName","P","mapId","m","mapName","M","placeId","1","createdAt","2026-01-01T00:00:00Z","customerUsername","example");Claim(Obj("order",order,"protectedOperatorUserIds",new object[0]));var job=D(ledger["current"]);var cmd=Obj("commandId","c","jobId",job["jobId"],"generation",job["generation"],"completionToken",job["completionToken"],"orderId","one");Complete(cmd);Complete(cmd);Require(A(ledger["handled"]).Length==1,"TEST");LoadLedger();Require(A(ledger["handled"]).Length==1,"TEST");File.WriteAllText(ledgerPath,"{");try{LoadLedger();throw new Exception();}catch(HostError e){Require(e.Code=="LEDGER_CORRUPT","TEST");}}finally{Directory.Delete(dir,true);}return 0;}catch(Exception ex){Console.Error.WriteLine("SELFTEST_FAIL "+ex);return 1;}}
}



