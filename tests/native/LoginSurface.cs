using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Public-page smoke only: never fills, submits, reads cookies or contacts RAM.
internal static class LoginSurface {
 [STAThread] static int Main(){
  string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BewpakornQueue","diagnostics");
  string profile=Path.Combine(root,Guid.NewGuid().ToString("N")),code="LOGIN_SURFACE_TIMEOUT";
  Directory.CreateDirectory(root);
  try{using(var form=new Form())using(var view=new WebView2())using(var timer=new System.Windows.Forms.Timer()){
   form.Text="Bewpakorn Queue — ตรวจหน้าล็อกอิน (ไม่ใช้บัญชีลูกค้า)";form.Width=900;form.Height=700;view.Dock=DockStyle.Fill;form.Controls.Add(view);
   DateTime end=DateTime.UtcNow.AddSeconds(40);bool checking=false;timer.Interval=500;
   timer.Tick+=async(s,e)=>{if(DateTime.UtcNow>=end){form.Close();return;}if(checking||view.CoreWebView2==null)return;checking=true;try{
    string ready=await view.CoreWebView2.ExecuteScriptAsync("!!(document.querySelector('#login-username')&&document.querySelector('#login-password')&&document.querySelector('#login-button'))");
    if(ready=="true"){code="LOGIN_FORM_READY";form.Close();}
   }catch{}finally{checking=false;}};
   form.Shown+=async(s,e)=>{timer.Start();try{var env=await CoreWebView2Environment.CreateAsync(null,profile);await view.EnsureCoreWebView2Async(env);view.CoreWebView2.Settings.IsPasswordAutosaveEnabled=false;view.CoreWebView2.Settings.IsGeneralAutofillEnabled=false;view.CoreWebView2.NewWindowRequested+=(a,b)=>b.Handled=true;view.CoreWebView2.NavigationStarting+=(a,b)=>{Uri u;if(!Uri.TryCreate(b.Uri,UriKind.Absolute,out u)||u.Scheme!="https"||!(u.Host=="roblox.com"||u.Host.EndsWith(".roblox.com")))b.Cancel=true;};view.CoreWebView2.Navigate("https://www.roblox.com/login");}catch{code="WEBVIEW_UNAVAILABLE";form.Close();}};
   Application.Run(form);
  }}catch{code="WEBVIEW_UNAVAILABLE";}finally{
   var full=Path.GetFullPath(profile);var prefix=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
   if(full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)&&Path.GetDirectoryName(full)==Path.GetFullPath(root))try{if(Directory.Exists(full))Directory.Delete(full,true);}catch{}
  }
  Console.WriteLine("{\"code\":\""+code+"\",\"customerLoginAttempted\":false}");return code=="LOGIN_FORM_READY"?0:1;
 }
}
