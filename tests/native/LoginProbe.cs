using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Fake-account probe: fills a nonexistent username with a dummy password on the
// public Sign in page, then reports the visible error text so the host can
// recognise wrong credentials instead of reporting a timeout. Never uses a real
// customer account and never stores the values it typed.
internal static class LoginProbe {
 [STAThread] static int Main(){
  string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BewpakornQueue","diagnostics");
  string profile=Path.Combine(root,Guid.NewGuid().ToString("N"));
  string username="bewqueueprobe"+Guid.NewGuid().ToString("N").Substring(0,8);
  string password="not-a-real-password-123";
  string report="{\"code\":\"PROBE_INCONCLUSIVE\"}";
  Directory.CreateDirectory(root);
  try{using(var form=new Form())using(var view=new WebView2())using(var timer=new System.Windows.Forms.Timer()){
   form.Text="Bewpakorn Queue - login probe (fake account)";form.Width=900;form.Height=700;view.Dock=DockStyle.Fill;form.Controls.Add(view);
   DateTime submitted=DateTime.MinValue;int phase=0;bool busy=false;timer.Interval=700;
   timer.Tick+=async(s,e)=>{
    if(busy||view.CoreWebView2==null)return;busy=true;
    try{
     var core=view.CoreWebView2;
     if(phase==0){
      if(await core.ExecuteScriptAsync(LoginFormScripts.Ready)=="true"){
       await core.ExecuteScriptAsync(LoginFormScripts.Fill(Quote(username),Quote(password)));
       var r=await core.ExecuteScriptAsync(LoginFormScripts.Submit);
       if(r=="\"CLICKED\""){phase=1;submitted=DateTime.UtcNow;}
      }
     } else if(DateTime.UtcNow.Subtract(submitted).TotalSeconds>14){
      timer.Stop();
      string detected=await core.ExecuteScriptAsync(LoginFormScripts.Issue);
      report=await core.ExecuteScriptAsync("(()=>{const vis=e=>e.getBoundingClientRect().height>0;const alerts=Array.from(document.querySelectorAll('[role=alert],[aria-live],.form-error,[class*=rror],[data-testid*=error]')).filter(vis).map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,6);return {path:location.pathname,alerts:alerts,body:(document.body.innerText||'').slice(0,300)};})()");
      report=report.Substring(0,report.Length-1)+",\"detected\":"+detected+"}";
      form.Close();
     }
    }catch{}finally{busy=false;}};
   form.Shown+=async(s,e)=>{timer.Start();try{var env=await CoreWebView2Environment.CreateAsync(null,profile);await view.EnsureCoreWebView2Async(env);view.CoreWebView2.Settings.IsPasswordAutosaveEnabled=false;view.CoreWebView2.Settings.IsGeneralAutofillEnabled=false;view.CoreWebView2.NewWindowRequested+=(a,b)=>b.Handled=true;view.CoreWebView2.NavigationStarting+=(a,b)=>{Uri u;if(!Uri.TryCreate(b.Uri,UriKind.Absolute,out u)||u.Scheme!="https"||!(u.Host=="roblox.com"||u.Host.EndsWith(".roblox.com")))b.Cancel=true;};view.CoreWebView2.Navigate("https://www.roblox.com/login");}catch{form.Close();}};
   Application.Run(form);
  }}catch{}
  finally{if(Directory.Exists(profile))try{Directory.Delete(profile,true);}catch{}}
  Console.WriteLine(report);return 0;
 }
 static string Quote(string value){return "\""+System.Web.HttpUtility.JavaScriptStringEncode(value)+"\"";}
}
