using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Fake-account probe: fills a nonexistent username with a dummy password on the
// public Sign in page, then reports the visible error text and the controls the
// host actually saw. Never uses a real customer account and never stores values.
internal static class LoginProbe {
 static string Quote(string value){return "\""+System.Web.HttpUtility.JavaScriptStringEncode(value)+"\"";}
 const string Diag="(()=>{"
  +"const vis=e=>{if(!e||e.isConnected===false)return false;const s=typeof getComputedStyle==='function'?getComputedStyle(e):null;return (!s||s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.opacity!=='0')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;};"
  +"const q=s=>Array.from(document.querySelectorAll(s)).filter(vis);"
  +"return {path:location.pathname,"
  +"inputs:{user:q('#login-username').length,password:q('#login-password').length},"
  +"buttons:q('button').slice(0,14).map(b=>({text:(b.textContent||'').trim().slice(0,32),type:b.type,disabled:b.disabled,aria:b.getAttribute('aria-disabled')})),"
  +"dialogs:q('[role=dialog],[aria-modal=true]').slice(0,4).map(d=>({role:d.getAttribute('role'),modal:d.getAttribute('aria-modal'),text:(d.innerText||'').trim().slice(0,140)})),"
  +"captchas:q('iframe[src*=captcha i],iframe[src*=arkose i],[data-testid=captcha]').length};})()";
 [STAThread] static int Main(){
  string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BewpakornQueue","diagnostics");
  string profile=Path.Combine(root,Guid.NewGuid().ToString("N"));
  string username="bewqueueprobe"+Guid.NewGuid().ToString("N").Substring(0,8);
  string password="not-a-real-password-123";
  string report="{\"code\":\"PROBE_INCONCLUSIVE\"}";
  Directory.CreateDirectory(root);
  try{using(var form=new Form())using(var view=new WebView2())using(var timer=new System.Windows.Forms.Timer()){
   form.Text="Bewpakorn Queue - login probe (fake account)";form.Width=900;form.Height=700;view.Dock=DockStyle.Fill;form.Controls.Add(view);
   DateTime submitted=DateTime.MinValue,deadline=DateTime.UtcNow.AddSeconds(30);int phase=0;bool busy=false;timer.Interval=700;
   timer.Tick+=async(s,e)=>{
    if(busy||view.CoreWebView2==null)return;busy=true;
    try{
     var core=view.CoreWebView2;
     if(phase==0){
      string ready=await core.ExecuteScriptAsync(LoginFormScripts.Ready);
      string diag=await core.ExecuteScriptAsync(Diag);
      report="{\"ready\":"+ready+",\"diag\":"+diag+"}";
      string stage=await core.ExecuteScriptAsync(LoginFormScripts.Stage(Quote(username),Quote(password)));string action="none";
      if(stage=="\"USER\"")action=await core.ExecuteScriptAsync(LoginFormScripts.FillUser(Quote(username)));
      else if(stage=="\"FILL_BOTH\"")action=await core.ExecuteScriptAsync(LoginFormScripts.Fill(Quote(username),Quote(password)));
      else if(stage=="\"PASSWORD\"")action=await core.ExecuteScriptAsync(LoginFormScripts.FillPassword(Quote(username),Quote(password)));
      else if(stage=="\"READY\""){action=await core.ExecuteScriptAsync(LoginFormScripts.Submit);if(action=="\"CLICKED\""){phase=1;submitted=DateTime.UtcNow;}}
      string challenge=await core.ExecuteScriptAsync(LoginFormScripts.ChallengeVisible);
      report="{\"ready\":"+ready+",\"stage\":"+stage+",\"action\":"+action+",\"challengeVisible\":"+challenge+",\"diag\":"+diag+"}";
      if(phase==0&&DateTime.UtcNow>deadline)form.Close();
     } else if(DateTime.UtcNow.Subtract(submitted).TotalSeconds>14){
      timer.Stop();
      string detected=await core.ExecuteScriptAsync(LoginFormScripts.Issue);
      string after=await core.ExecuteScriptAsync("(()=>{const vis=e=>e.getBoundingClientRect().height>0;return {path:location.pathname,body:(document.body.innerText||'').slice(0,300),alerts:Array.from(document.querySelectorAll('[role=alert],[aria-live],.form-error,[class*=rror],[data-testid*=error]')).filter(vis).map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,6)};})()");
      report=report.Substring(0,report.Length-1)+",\"detected\":"+detected+",\"after\":"+after+"}";
      form.Close();
     }
    }catch{}finally{busy=false;}};
   form.Shown+=async(s,e)=>{timer.Start();try{var env=await CoreWebView2Environment.CreateAsync(null,profile);await view.EnsureCoreWebView2Async(env);view.CoreWebView2.Settings.IsPasswordAutosaveEnabled=false;view.CoreWebView2.Settings.IsGeneralAutofillEnabled=false;view.CoreWebView2.NewWindowRequested+=(a,b)=>b.Handled=true;view.CoreWebView2.NavigationStarting+=(a,b)=>{Uri u;if(!Uri.TryCreate(b.Uri,UriKind.Absolute,out u)||u.Scheme!="https"||!(u.Host=="roblox.com"||u.Host.EndsWith(".roblox.com")))b.Cancel=true;};view.CoreWebView2.Navigate("https://www.roblox.com/login");}catch{form.Close();}};
   Application.Run(form);
  }}catch{}
  finally{if(Directory.Exists(profile))try{Directory.Delete(profile,true);}catch{}}
  Console.WriteLine(report);return 0;
 }
}
