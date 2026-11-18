using System;
using System.Collections.Generic;
using System.IO;
using System.Net;

internal static partial class Host {
 sealed class FakeChromeLoginBrowser:IChromeLoginBrowser {
  internal bool IsAlive=true,KeptValues,Clicked,ThrowSubmit,Disposed,AlwaysPending;internal int Fills,Submits,Clicks,CookieReads,ForgetFills,Evaluations,PendingNavigations;
  internal Uri Url=new Uri("https://www.roblox.com/th/login");internal string Issue="",AfterCookie,SubmitResult="CLICKED",ForcedCheck;internal Action BeforeSubmit,OnDispose;
  internal Queue<string> SubmitResults=new Queue<string>();
  public bool Alive {get{return IsAlive;}}
  public Uri PageUri {get{if(AlwaysPending)throw new ChromeNavigationPending();if(PendingNavigations>0){PendingNavigations--;throw new ChromeNavigationPending();}return Url;}}
  public object Evaluate(ChromeOperation operation,string username,string password){
   Evaluations++;
   if(operation==ChromeOperation.Issue)return Issue;
   if(operation==ChromeOperation.Ready)return true;
   if(operation==ChromeOperation.CheckFilled)return ForcedCheck??(KeptValues?"MATCHED":"EMPTY");
   if(operation==ChromeOperation.Fill){Fills++;KeptValues=Fills>ForgetFills;return true;}
   if(operation==ChromeOperation.Submit){Submits++;if(BeforeSubmit!=null)BeforeSubmit();if(ThrowSubmit)throw new IOException();string result=SubmitResults.Count>0?SubmitResults.Dequeue():SubmitResult;if(result=="CLICKED"){Clicks++;Clicked=true;}return result;}
   throw new Exception("TEST_CHROME_OPERATION");
  }
  public string Cookie(){CookieReads++;return Clicked?"fixture-chrome-cookie":AfterCookie;}
  public void Dispose(){Disposed=true;if(OnDispose!=null)OnDispose();}
 }
 sealed class ChromeLoginFixture {
  internal DateTime Time=new DateTime(2026,1,1,0,0,0,DateTimeKind.Utc);internal bool Current=true;internal List<string> Codes=new List<string>(),Phases=new List<string>();internal List<bool> Marks=new List<bool>();internal Action<int> OnPause;
  internal bool PasswordCleared;
  internal string Run(FakeChromeLoginBrowser browser){string password="fixture-password";try{return ChromeLoginFlow(browser,"Customer",ref password,()=>Current,p=>Phases.Add(p),c=>Codes.Add(c),v=>{Marks.Add(v);return Current;},()=>Time,ms=>{Time=Time.AddMilliseconds(ms);if(OnPause!=null)OnPause(ms);});}finally{PasswordCleared=password==null;}}
  internal string LastCode {get{return Codes.Count==0?"":Codes[Codes.Count-1];}}
 }
 static void ChromeLoginSelfTests(){
  var originalAuth=authenticate;var originalImport=importSession;
  try{
   int imports=0;importSession=c=>{imports++;throw new Exception("TEST_CHROME_MUST_NOT_IMPORT");};authenticate=c=>Obj("id","123","name","cUsToMeR");
   var browser=new FakeChromeLoginBrowser();var fixture=new ChromeLoginFixture();browser.BeforeSubmit=()=>Require(fixture.Marks.Count>0&&fixture.Marks[fixture.Marks.Count-1],"TEST_CHROME_MARK_BEFORE_DISPATCH");
   Require(fixture.Run(browser)=="fixture-chrome-cookie"&&browser.Fills==1&&browser.Clicks==1&&fixture.Marks.Count==1&&fixture.Marks[0]&&imports==0&&fixture.PasswordCleared,"TEST_CHROME_VERIFIED_NO_IMPORT");

   browser=new FakeChromeLoginBrowser{Url=new Uri("about:blank")};fixture=new ChromeLoginFixture();fixture.OnPause=ms=>{Require(browser.CookieReads==0&&browser.Evaluations==0,"TEST_CHROME_INITIAL_BLANK_NO_PAGE_ACCESS");browser.Url=new Uri("https://www.roblox.com/login");fixture.OnPause=null;};Require(fixture.Run(browser)=="fixture-chrome-cookie"&&browser.Fills==1&&browser.Clicks==1,"TEST_CHROME_INITIAL_BLANK_WAITS");
   browser=new FakeChromeLoginBrowser{Url=new Uri("about:blank")};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.CookieReads==0&&browser.Evaluations==0&&fixture.Time==new DateTime(2026,1,1,0,0,20,DateTimeKind.Utc)&&fixture.LastCode=="LOGIN_FORM_TIMEOUT","TEST_CHROME_INITIAL_BLANK_BOUNDED");
   browser=new FakeChromeLoginBrowser();fixture=new ChromeLoginFixture();fixture.OnPause=ms=>browser.Url=new Uri("about:blank");Require(fixture.Run(browser)==null&&browser.CookieReads==1&&browser.Submits==0&&fixture.LastCode=="CHROME_NAVIGATION_DENIED","TEST_CHROME_BLANK_AFTER_TRUST_DENIED");
   browser=new FakeChromeLoginBrowser{PendingNavigations=1};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)=="fixture-chrome-cookie"&&browser.Clicks==1,"TEST_CHROME_TRANSIENT_CONTEXT_WAITS");
   browser=new FakeChromeLoginBrowser{AlwaysPending=true};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.CookieReads==0&&fixture.PasswordCleared&&fixture.Time==new DateTime(2026,1,1,0,1,0,DateTimeKind.Utc)&&fixture.LastCode=="LOGIN_FORM_TIMEOUT","TEST_CHROME_CONTEXT_DEADLINE_CLEARS_PASSWORD");

   browser=new FakeChromeLoginBrowser{ForgetFills=1};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)=="fixture-chrome-cookie"&&browser.Fills==2&&browser.Clicks==1,"TEST_CHROME_REFILL_EMPTY_ONLY");
   browser=new FakeChromeLoginBrowser{ForgetFills=4};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Fills==3&&browser.Submits==0&&fixture.LastCode=="LOGIN_FORM_CHANGED","TEST_CHROME_FILL_BOUND");
   browser=new FakeChromeLoginBrowser{ForcedCheck="MISMATCH"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Fills==0&&browser.Submits==0&&fixture.LastCode=="LOGIN_FORM_CHANGED","TEST_CHROME_NO_OVERWRITE");

   foreach(var safe in new[]{"PENDING","EMPTY","MISSING","CHALLENGE"}){
    browser=new FakeChromeLoginBrowser();browser.SubmitResults.Enqueue(safe);browser.SubmitResults.Enqueue("CLICKED");fixture=new ChromeLoginFixture();Require(fixture.Run(browser)=="fixture-chrome-cookie"&&browser.Submits==2&&browser.Clicks==1&&fixture.Marks.Count==3&&fixture.Marks[0]&&!fixture.Marks[1]&&fixture.Marks[2],"TEST_CHROME_EXPLICIT_NO_CLICK_RETRY");
   }
   foreach(var unknown in new[]{"UNKNOWN","MISMATCH","", "LOCATION_CHANGED"}){
    browser=new FakeChromeLoginBrowser{SubmitResult=unknown};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Submits==1&&fixture.Marks.Count==1&&fixture.Marks[0],"TEST_CHROME_UNKNOWN_NEVER_RETRY");
   }
   browser=new FakeChromeLoginBrowser{ThrowSubmit=true};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Submits==1&&fixture.Marks.Count==1&&fixture.Marks[0]&&fixture.LastCode=="LOGIN_FORM_CHANGED","TEST_CHROME_LOST_SUBMIT_RESPONSE");

   browser=new FakeChromeLoginBrowser{SubmitResult="PENDING"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Clicks==0&&fixture.Time<=new DateTime(2026,1,1,0,1,1,DateTimeKind.Utc)&&fixture.LastCode=="LOGIN_SUBMIT_TIMEOUT","TEST_CHROME_PRECLICK_DEADLINE");
   browser=new FakeChromeLoginBrowser{Issue="CUSTOMER_CAPTCHA_REQUIRED"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Fills==0&&browser.Submits==0&&fixture.Time==new DateTime(2026,1,1,0,10,0,DateTimeKind.Utc)&&fixture.LastCode=="CUSTOMER_CAPTCHA_REQUIRED","TEST_CHROME_MANUAL_CHALLENGE_RETAINS_ISSUE");
   browser=new FakeChromeLoginBrowser{Issue="CUSTOMER_OTP_REQUIRED"};fixture=new ChromeLoginFixture();fixture.OnPause=ms=>{browser.AfterCookie="fixture-chrome-cookie";browser.Issue="";};Require(fixture.Run(browser)=="fixture-chrome-cookie"&&browser.Fills==0&&browser.Submits==0,"TEST_CHROME_MANUAL_COOKIE_VERIFIED");
   browser=new FakeChromeLoginBrowser{Issue="CUSTOMER_PASSWORD_INVALID"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Fills==0&&browser.Submits==0&&fixture.LastCode=="CUSTOMER_PASSWORD_INVALID","TEST_CHROME_PASSWORD_ISSUE_NOT_TIMEOUT");

   browser=new FakeChromeLoginBrowser();fixture=new ChromeLoginFixture();browser.BeforeSubmit=()=>fixture.Current=false;Require(fixture.Run(browser)==null&&browser.Clicks==1,"TEST_CHROME_STALE_AFTER_DISPATCH");
   browser=new FakeChromeLoginBrowser{IsAlive=false};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.CookieReads==0&&fixture.LastCode=="CHROME_SESSION_CLOSED","TEST_CHROME_ONLY_OWNED_PROCESS_LIFETIME");
   foreach(var url in new[]{"http://www.roblox.com/login","https://www.roblox.com.evil.test/login","https://evil.test/login","https://www.roblox.com:444/login","https://user@www.roblox.com/login"}){
    browser=new FakeChromeLoginBrowser{Url=new Uri(url)};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&browser.Fills==0&&browser.CookieReads==0&&fixture.LastCode=="CHROME_NAVIGATION_DENIED","TEST_CHROME_EXTERNAL_NAVIGATION_FENCE");
   }

   int validations=0;authenticate=c=>{validations++;if(validations<3)throw new WebException("fixture",WebExceptionStatus.Timeout);return Obj("id","123","name","Customer");};browser=new FakeChromeLoginBrowser{AfterCookie="fixture-chrome-cookie"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)=="fixture-chrome-cookie"&&validations==3,"TEST_CHROME_TRANSIENT_GET_RETRIES");
   validations=0;authenticate=c=>{validations++;throw new WebException("fixture",WebExceptionStatus.Timeout);};browser=new FakeChromeLoginBrowser{AfterCookie="fixture-chrome-cookie"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&validations==3&&fixture.LastCode=="CUSTOMER_VERIFICATION_UNAVAILABLE","TEST_CHROME_GET_RETRY_BOUND");
   validations=0;authenticate=c=>{validations++;throw new WebException("fixture",WebExceptionStatus.ProtocolError);};browser=new FakeChromeLoginBrowser{AfterCookie="fixture-chrome-cookie"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&validations==1,"TEST_CHROME_NO_PERMANENT_GET_RETRY");
   authenticate=c=>Obj("id","123","name","OtherCustomer");browser=new FakeChromeLoginBrowser{AfterCookie="fixture-chrome-cookie"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&fixture.LastCode=="CUSTOMER_ID_MISMATCH"&&imports==0,"TEST_CHROME_IDENTITY_MATCH_REQUIRED");
   authenticate=c=>Obj("id","0","name","Customer");browser=new FakeChromeLoginBrowser{AfterCookie="fixture-chrome-cookie"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null&&fixture.LastCode=="CUSTOMER_ID_MISMATCH","TEST_CHROME_POSITIVE_ID_REQUIRED");
   authenticate=c=>{fixture.Current=false;return Obj("id","123","name","Customer");};browser=new FakeChromeLoginBrowser{AfterCookie="fixture-chrome-cookie"};fixture=new ChromeLoginFixture();Require(fixture.Run(browser)==null,"TEST_CHROME_CANCEL_DURING_AUTH");

   const string browserPath="/devtools/browser/01234567-89ab-cdef-0123-456789abcdef";var endpoint=ChromeEndpoint.Parse("49388\n"+browserPath+"\n");Require(endpoint.Port==49388&&endpoint.BrowserPath==browserPath,"TEST_CHROME_PRIVATE_ENDPOINT");
   foreach(var invalid in new[]{"80\n"+browserPath,"65536\n"+browserPath,"49388\n/devtools/browser/../../page","49388\nws://evil.test/","49388\n"+browserPath+"\nextra"," 49388\n"+browserPath}){
    bool rejected=false;try{ChromeEndpoint.Parse(invalid);}catch(HostError){rejected=true;}Require(rejected,"TEST_CHROME_ENDPOINT_REJECT");
   }
   Require(ChromeEndpoint.TrustedSocket(new Uri("ws://127.0.0.1:49388"+browserPath),49388,browserPath),"TEST_CHROME_LOOPBACK_SOCKET");
   foreach(var invalid in new[]{"ws://localhost:49388"+browserPath,"ws://127.0.0.1:49389"+browserPath,"wss://127.0.0.1:49388"+browserPath,"ws://127.0.0.1:49388"+browserPath+"?x=1","ws://user@127.0.0.1:49388"+browserPath,"ws://evil.test:49388"+browserPath})Require(!ChromeEndpoint.TrustedSocket(new Uri(invalid),49388,browserPath),"TEST_CHROME_UNTRUSTED_SOCKET");
   foreach(var operation in new[]{ChromeOperation.Fill,ChromeOperation.CheckFilled,ChromeOperation.Submit}){
    string expression=ChromeExpression(operation,"Customer","fixture-password");Require(expression.StartsWith("(()=>{if(!(location.protocol==='https:'",StringComparison.Ordinal)&&expression.IndexOf("login\\/?$",StringComparison.Ordinal)>0&&expression.IndexOf("LOCATION_CHANGED",StringComparison.Ordinal)<expression.IndexOf("const visible=",StringComparison.Ordinal),"TEST_CHROME_ATOMIC_LOCATION_GUARD");
   }
   var root=Path.Combine(Path.GetTempPath(),"bewqueue-chrome-profile-test-"+NewId());Directory.CreateDirectory(root);
   try{var profile=Path.Combine(root,NewId());Directory.CreateDirectory(profile);ChromeDeleteProfile(root,profile);Require(!Directory.Exists(profile),"TEST_CHROME_OWNED_PROFILE_DELETED");bool rejected=false;try{ChromeDeleteProfile(root,root);}catch(HostError){rejected=true;}Require(rejected&&Directory.Exists(root),"TEST_CHROME_DELETE_SCOPE");}
   finally{Directory.Delete(root,true);}
   // A host shutdown is sticky in production and rejects constructors before
   // executable/profile discovery. Restore it only inside isolated self-tests.
   bool shutdownBefore;lock(ChromeRegistryGate){Require(ChromeBrowsers.Count==0,"TEST_CHROME_REGISTRY_EMPTY");shutdownBefore=chromeShuttingDown;}
   var registered=new FakeChromeLoginBrowser();registered.OnDispose=()=>{Require(chromeShuttingDown,"TEST_CHROME_SHUTDOWN_GATE_BEFORE_DISPOSE");lock(ChromeRegistryGate){ChromeBrowsers.Remove(registered);}};
   try{lock(ChromeRegistryGate){ChromeBrowsers.Add(registered);}ShutdownChromeLogins();Require(registered.Disposed,"TEST_CHROME_REGISTERED_SESSION_DISPOSED");bool rejected=false;try{using(var owned=new OwnedChromeBrowser(()=>true)){}}catch(HostError error){rejected=error.Code=="CHROME_CANCELLED";}Require(rejected&&ChromeBrowsers.Count==0,"TEST_CHROME_NO_START_AFTER_SHUTDOWN");}
   finally{lock(ChromeRegistryGate){ChromeBrowsers.Remove(registered);chromeShuttingDown=shutdownBefore;}}
  }finally{authenticate=originalAuth;importSession=originalImport;}
 }
}
