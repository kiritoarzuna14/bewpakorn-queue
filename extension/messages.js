export const problems = {RAM_IMPORT_UNCERTAIN:'RAM ยังไม่ยืนยันผลนำเข้า กำลังรอผลเดิมก่อนเปลี่ยนคิว',ROLE_CONFLICT:'บัญชีลูกค้าตรงกับบัญชีของคุณที่ตั้งค่าไว้ กรุณาตรวจสอบ',OPERATOR_NOT_MAPPED:'ยังไม่ได้จับคู่บัญชีของคุณกับแมพนี้',OPERATOR_SESSION_INVALID:'เซสชันบัญชีของคุณใช้ไม่ได้ กรุณาตรวจใน RAM',OPERATOR_ID_MISMATCH:'บัญชีใน RAM ไม่ตรงกับบัญชีที่เลือก',OPERATOR_MAP_MISMATCH:'บัญชีใน RAM ไม่ตรงกับแมพที่เลือก',CUSTOMER_ID_MISMATCH:'ตรวจพบตัวตนลูกค้าไม่ตรงกับบัญชีในออเดอร์',ROBLOX_DENIED:'Roblox ปฏิเสธคำขอ กรุณาตรวจบัญชีเพิ่มเติม',RAM_IMPORT_FAILED:'นำเข้าบัญชีไป RAM ไม่สำเร็จ กรุณาตรวจ RAM',RAM_PERSISTENCE_UNVERIFIED:'ยังยืนยันบัญชีที่บันทึกใน RAM ไม่ได้',SETUP_REQUIRED:'กรุณาตั้งค่าและจับคู่บัญชีก่อนเริ่ม',NATIVE_DISCONNECTED:'ยังเชื่อมต่อตัวเชื่อมในเครื่องไม่ได้',NATIVE_TIMEOUT:'ตัวเชื่อมตอบกลับช้า กรุณาตรวจสอบการเชื่อมต่อ',ORDER_CREDENTIALS_MISSING:'อ่านข้อมูลบัญชีลูกค้าไม่ครบ กรุณาตรวจหน้าออเดอร์',ORDER_FIELDS_INVALID:'อ่านช่องบัญชีลูกค้าไม่ครบ กรุณาตรวจหน้าออเดอร์',RECOVERY_REQUIRED:'งานเดิมต้องตรวจสอบหลังเปิดระบบใหม่',CUSTOMER_PHONE_VERIFICATION:'บัญชีลูกค้ารอการยืนยันผ่านมือถือ กรุณาจัดการในหน้าต่างล็อกอิน',CUSTOMER_OTP_REQUIRED:'บัญชีลูกค้ารอรหัสยืนยัน กรุณากรอกเองในหน้าต่างล็อกอิน',CUSTOMER_CAPTCHA_REQUIRED:'บัญชีลูกค้ารอการยืนยัน CAPTCHA กรุณาจัดการเองในหน้าต่างล็อกอิน',CUSTOMER_PASSWORD_INVALID:'บัญชีลูกค้าล็อกอินไม่ผ่าน กรุณาตรวจรหัสผ่าน',LOGIN_FORM_TIMEOUT:'ยังเปิดหน้าล็อกอินไม่ได้ กรุณาตรวจการเชื่อมต่อ',CUSTOMER_LOGIN_TIMEOUT:'ยังยืนยันการล็อกอินของลูกค้าไม่ได้ กรุณาตรวจหน้าต่างล็อกอิน',UNKNOWN_ERROR:'ตรวจสอบรายละเอียดงานและลองอีกครั้ง'};
Object.assign(problems, {
 LOGIN_SUBMIT_TIMEOUT:'กรอกข้อมูลแล้วแต่ปุ่ม Sign in ยังไม่พร้อม กรุณาตรวจหน้าต่างล็อกอิน',
 RAM_RECEIVER_UNAVAILABLE:'ยังเชื่อมต่อช่องนำเข้าไม่ได้ กรุณาเปิด Bewpakorn RAM และปลดล็อกโปรแกรม',
 RAM_RECEIVER_AMBIGUOUS:'พบ RAM หลายชุด กรุณาปิด Roblox Account Manager เดิมและเหลือ Bewpakorn RAM ชุดที่ตั้งค่าไว้',
 SHOP_LOGIN_REQUIRED:'กรุณาเข้าสู่ระบบร้านใน Chrome แล้วเปิดคิวอีกครั้ง',
 SHOP_READ_FAILED:'อ่านข้อมูลร้านไม่ได้ กรุณาตรวจการเชื่อมต่อ',
 SHOP_API_CHANGED:'รูปแบบข้อมูลร้านเปลี่ยน ระบบหยุดเพื่อป้องกันการอ่านคิวผิด',
 SCAN_CHANGED:'คิวร้านเปลี่ยนระหว่างอ่าน กรุณากดไอคอนส่วนขยายเพื่ออ่านใหม่',
 SCAN_INCOMPLETE:'ยังอ่านคิวได้ไม่ครบ ระบบยังไม่เลือกออเดอร์',
 ORDER_CHANGED:'ออเดอร์เปลี่ยนหลังเลือก กรุณาตรวจหน้าแก้ไขออเดอร์',
 WEBVIEW_UNAVAILABLE:'เปิดหน้าล็อกอินแยกไม่ได้ กรุณาตรวจ Microsoft Edge WebView2',
 RAM_DATABASE_LOCKED:'ไฟล์บัญชี RAM ถูกล็อกหรือใช้รูปแบบที่ยังอ่านไม่ได้ กรุณาตรวจ RAM',
 OPERATOR_VALIDATION_UNAVAILABLE:'ยังตรวจเซสชันบัญชีของคุณไม่ได้ กรุณาตรวจการเชื่อมต่อ',
 CUSTOMER_VERIFICATION_UNAVAILABLE:'ยังตรวจตัวตนลูกค้าไม่ได้ กรุณาตรวจหน้าต่างล็อกอิน',
 CUSTOMER_LOGIN_CLOSED:'หน้าต่างล็อกอินลูกค้าถูกปิดแล้ว รอคุณจัดการงานนี้',
 LOGIN_FORM_CHANGED:'รูปแบบหน้าล็อกอินเปลี่ยน กรุณาจัดการในหน้าต่างล็อกอิน',
 COMPLETION_PENDING:'กำลังรอผลคำสั่งสำเร็จเดิม ระบบจะไม่จบงานซ้ำ'
});
export function problemMessage(code){return problems[code] || problems.UNKNOWN_ERROR;}
