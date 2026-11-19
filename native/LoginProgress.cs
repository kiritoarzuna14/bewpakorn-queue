using System;

// No credentials or browser actions: this policy only controls when the host
// may prepare/submit and when a human verification must keep its real reason.
internal sealed class LoginProgress {
 internal DateTime FormDeadline;
 internal DateTime LoginDeadline=DateTime.MaxValue,HumanDeadline=DateTime.MaxValue;
 internal bool Submitted,WaitingForUser;
 internal int Fills;
 internal string LastManualCode;
 // Set when the only evidence for a pause was an unreadable dialog. Such a
 // dialog (cookie notice, upsell) must not stall a still usable form.
 internal DateTime DialogOnlySince=DateTime.MaxValue;
 internal LoginProgress(DateTime now){FormDeadline=now.AddSeconds(60);}
 internal static bool Manual(string code){return code=="CUSTOMER_CAPTCHA_REQUIRED"||code=="CUSTOMER_OTP_REQUIRED"||code=="CUSTOMER_PHONE_VERIFICATION"||code=="CUSTOMER_IDENTITY_VERIFICATION";}
 internal string Observe(string issue,bool visibleDialog,DateTime now){
  string manual=Manual(issue)?issue:String.IsNullOrEmpty(issue)&&visibleDialog?"CUSTOMER_IDENTITY_VERIFICATION":"";
  if(manual!=""){if(HumanDeadline==DateTime.MaxValue)HumanDeadline=now.AddMinutes(10);WaitingForUser=true;LastManualCode=manual;DialogOnlySince=Manual(issue)?DateTime.MaxValue:(DialogOnlySince==DateTime.MaxValue?now:DialogOnlySince);return manual;}
  DialogOnlySince=DateTime.MaxValue;
  if(WaitingForUser){
   WaitingForUser=false;LoginDeadline=now.AddSeconds(90);
   // The human verification used up the preparation window. Reopen it instead
   // of discarding the password the user was just asked to stand behind.
   if(!Submitted)FormDeadline=now.AddSeconds(120);
  }
  return "";
 }
 internal bool BenignDialog(DateTime now){return WaitingForUser&&LastManualCode=="CUSTOMER_IDENTITY_VERIFICATION"&&DialogOnlySince!=DateTime.MaxValue&&now>=DialogOnlySince.AddSeconds(15);}
 internal void Resume(DateTime now){WaitingForUser=false;DialogOnlySince=DateTime.MaxValue;LoginDeadline=now.AddSeconds(90);if(!Submitted)FormDeadline=now.AddSeconds(120);}
 internal bool CanAutomate(DateTime now){return !Submitted&&!WaitingForUser&&now<FormDeadline;}
 internal bool BeginSubmission(DateTime now){if(!CanAutomate(now))return false;Submitted=true;LoginDeadline=now.AddSeconds(90);return true;}
 internal bool ProveNoClick(string status){if(status!="PENDING"&&status!="CHALLENGE"&&status!="EMPTY"&&status!="MISSING")return false;Submitted=false;return true;}
 internal bool RecordFill(){if(Fills>=3)return false;Fills++;return true;}
 internal string Timeout(DateTime now){
  if(WaitingForUser)return now>=HumanDeadline?LastManualCode:"";
  if(Submitted||HumanDeadline!=DateTime.MaxValue)return now>=LoginDeadline?"CUSTOMER_LOGIN_TIMEOUT":"";
  return now>=FormDeadline?(Fills>0?"LOGIN_SUBMIT_TIMEOUT":"LOGIN_FORM_TIMEOUT"):"";
 }
}
