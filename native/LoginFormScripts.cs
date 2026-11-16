// Shared by the host and the public-page diagnostic. Credentials are arguments
// to Fill and are never stored in these scripts or diagnostic output.
internal static class LoginFormScripts {
 internal const string Resolver="const u=document.querySelector('#login-username'),p=document.querySelector('#login-password'),legacy=document.querySelector('#login-button');const formButtons=p?.form?Array.from(p.form.querySelectorAll('button[type=submit]')):[];const named=Array.from(document.querySelectorAll('button')).filter(e=>e.type==='submit'&&/^(sign in|log in|เข้าสู่ระบบ|ลงชื่อเข้าใช้)$/i.test((e.textContent||'').trim()));const b=legacy||(formButtons.length===1?formButtons[0]:named.length===1?named[0]:null);";
 internal const string ReadyBody="return !!(u&&p&&b&&!u.disabled&&!p.disabled&&!u.readOnly&&!p.readOnly);";
 internal const string FillBody="if(!u||!p||!b||u.disabled||p.disabled||u.readOnly||p.readOnly)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(u,username);u.dispatchEvent(new Event('input',{bubbles:true}));u.dispatchEvent(new Event('change',{bubbles:true}));set.call(p,password);p.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('change',{bubbles:true}));return true;";
 internal const string SubmitBody="if(!u||!p||!b)return 'MISSING';const modal=Array.from(document.querySelectorAll('[role=dialog],[aria-modal=true]')).some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);if(modal)return 'CHALLENGE';if(b.disabled||b.getAttribute('aria-disabled')==='true')return 'PENDING';b.click();return 'CLICKED';";
 internal static string Ready {get{return "(()=>{"+Resolver+ReadyBody+"})()";}}
 internal static string Fill(string usernameJson,string passwordJson){return "((username,password)=>{"+Resolver+FillBody+"})("+usernameJson+","+passwordJson+")";}
 internal static string Submit {get{return "(()=>{"+Resolver+SubmitBody+"})()";}}
}
