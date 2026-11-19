export const problems = {RAM_IMPORT_UNCERTAIN:'RAM ยังไม่ยืนยันผลนำเข้า กำลังรอผลเดิมก่อนเปลี่ยนคิว',ROLE_CONFLICT:'บัญชีลูกค้าตรงกับบัญชีของคุณที่ตั้งค่าไว้ กรุณาตรวจสอบ',OPERATOR_NOT_MAPPED:'ยังไม่ได้จับคู่บัญชีของคุณกับแมพนี้',OPERATOR_SESSION_INVALID:'เซสชันบัญชีของคุณใช้ไม่ได้ กรุณาตรวจใน RAM',OPERATOR_ID_MISMATCH:'บัญชีใน RAM ไม่ตรงกับบัญชีที่เลือก',OPERATOR_MAP_MISMATCH:'บัญชีใน RAM ไม่ตรงกับแมพที่เลือก',CUSTOMER_ID_MISMATCH:'ตรวจพบตัวตนลูกค้าไม่ตรงกับบัญชีในออเดอร์',ROBLOX_DENIED:'Roblox ปฏิเสธคำขอ กรุณาตรวจบัญชีเพิ่มเติม',RAM_IMPORT_FAILED:'นำเข้าบัญชีไป RAM ไม่สำเร็จ กรุณาตรวจ RAM',RAM_PERSISTENCE_UNVERIFIED:'ยังยืนยันบัญชีที่บันทึกใน RAM ไม่ได้',SETUP_REQUIRED:'กรุณาตั้งค่าและจับคู่บัญชีก่อนเริ่ม',NATIVE_DISCONNECTED:'ยังเชื่อมต่อตัวเชื่อมในเครื่องไม่ได้',NATIVE_TIMEOUT:'ตัวเชื่อมตอบกลับช้า กรุณาตรวจสอบการเชื่อมต่อ',ORDER_CREDENTIALS_MISSING:'อ่านข้อมูลบัญชีลูกค้าไม่ครบ กรุณาตรวจหน้าออเดอร์',ORDER_FIELDS_INVALID:'อ่านช่องบัญชีลูกค้าไม่ครบ กรุณาตรวจหน้าออเดอร์',RECOVERY_REQUIRED:'งานเดิมต้องตรวจสอบหลังเปิดระบบใหม่',CUSTOMER_PHONE_VERIFICATION:'บัญชีลูกค้ารอการยืนยันผ่านมือถือ กรุณาจัดการในหน้าต่างล็อกอิน',CUSTOMER_OTP_REQUIRED:'บัญชีลูกค้ารอรหัสยืนยัน กรุณากรอกเองในหน้าต่างล็อกอิน',CUSTOMER_CAPTCHA_REQUIRED:'บัญชีลูกค้ารอการยืนยัน CAPTCHA กรุณาจัดการเองในหน้าต่างล็อกอิน',CUSTOMER_PASSWORD_INVALID:'บัญชีลูกค้าล็อกอินไม่ผ่าน กรุณาตรวจรหัสผ่าน',LOGIN_FORM_TIMEOUT:'ยังเปิดหน้าล็อกอินไม่ได้ กรุณาตรวจการเชื่อมต่อ',CUSTOMER_LOGIN_TIMEOUT:'ยังยืนยันการล็อกอินของลูกค้าไม่ได้ กรุณาตรวจหน้าต่างล็อกอิน',UNKNOWN_ERROR:'ตรวจสอบรายละเอียดงานและลองอีกครั้ง'};
Object.assign(problems, {
 NATIVE_UPDATE_REQUIRED:'ตัวเชื่อมยังเป็นรุ่นเก่า กรุณาอัปเดตแล้ว Reload ส่วนขยาย',
 INVALID_OPERATOR_POOL:'รายชื่อบัญชีร้านไม่ถูกต้อง กรุณาตรวจการตั้งค่าแมพ',
 INVALID_PRIVATE_SOURCE:'ยังไม่ได้เลือกบัญชีที่เก็บ Private ของแมพนี้',
 CUSTOMER_SESSION_NOT_READY:'บัญชีลูกค้ายังไม่พร้อมใช้งานใน RAM กรุณาจัดการล็อกอินก่อน',
 CUSTOMER_SESSION_INVALID:'เซสชันลูกค้าใช้ไม่ได้ กรุณาตรวจบัญชี',
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
 COMPLETION_PENDING:'กำลังรอผลคำสั่งสำเร็จเดิม ระบบจะไม่จบงานซ้ำ',
 CUSTOMER_IDENTITY_VERIFICATION:'บัญชีลูกค้ารอการยืนยันตัวตน (รหัสทางอีเมล/พาสคีย์) กรุณาทำในหน้าต่างล็อกอิน',
 CUSTOMER_LOGIN_RATE_LIMITED:'Roblox จำกัดการพยายามล็อกอิน กรุณารอแล้วลองเริ่มงานเดิมใหม่',
 NOTHING_TO_UNDO:'ยังไม่มีออเดอร์ที่เพิ่งกดสำเร็จให้ย้อนกลับ',
 ORDER_HISTORY_UNAVAILABLE:'ยังอ่านข้อมูลออเดอร์จากประวัติไม่ได้ กรุณาตรวจการเข้าสู่ระบบร้านแล้วลองอีกครั้ง',
 CUSTOMER_LOGIN_UNAVAILABLE:'หน้าต่างล็อกอินลูกค้าขัดข้อง กรุณากดไอคอนเพื่อเริ่มงานนี้ใหม่'
});
export function problemMessage(code){return problems[code] || problems.UNKNOWN_ERROR;}

Object.assign(problems,{STALE_JOB:"ออเดอร์หรือบัญชีเปลี่ยนแล้ว กรุณาเลือกอีกครั้ง",BUSY:"กำลังทำรายการ กรุณารอสักครู่",INVALID_SELECTION:"กรุณาเลือกบัญชีสำหรับงานนี้อีกครั้ง",RAM_ACCOUNT_NOT_FOUND:"ไม่พบบัญชีที่เลือกใน RAM",NAVIGATION_PENDING:"กำลังรอผลย้อนกลับเดิม"});
Object.assign(problems,{OPERATOR_SESSION_INVALID:'เซสชันบัญชีที่เลือกใช้ไม่ได้ กรุณาล็อกอินบัญชีนี้ใหม่ใน RAM',OPERATOR_VALIDATION_UNAVAILABLE:'ยังตรวจเซสชันบัญชีที่เลือกไม่ได้ กรุณาตรวจการเชื่อมต่อ',RAM_VALIDATION_UNAVAILABLE:'ยังอ่านหรือตรวจบัญชีที่เลือกใน RAM ไม่ได้ กรุณาตรวจ RAM',STALE_HISTORY:'ประวัติออเดอร์เปลี่ยนแล้ว กรุณากดย้อนกลับใหม่',CUSTOMER_SOURCE_CHANGED:'บัญชีลูกค้าเปลี่ยนแล้ว กรุณาเลือกบัญชีอีกครั้ง',INVALID_ACCOUNT_SELECTION:'ข้อมูลบัญชีที่เลือกไม่ถูกต้อง กรุณาเลือกอีกครั้ง'});
Object.assign(problems,{
 BROWSER_LOGIN_WAITING:'กรุณาล็อกอินบัญชีลูกค้าบน Chrome (หากมีหน้ายืนยันตัวตน/OTP ให้กดยืนยันเองได้เลย)',
 ROBLOX_PROTOCOL_UNAVAILABLE:'ไม่พบตัวเปิดเกม Roblox บนเครื่องนี้ กรุณาติดตั้ง Roblox Player',
 ROBLOX_PROTOCOL_UNTRUSTED:'ตัวเปิดเกม Roblox ไม่ผ่านการตรวจลายเซ็นดิจิทัล',
 GAME_LAUNCH_CHALLENGE:'Roblox ขอการยืนยันเพิ่มเติมตอนขอตั๋วเข้าเกม กรุณาลองเปิดเกมจาก RAM หรือลองอีกครั้ง',
 GAME_LAUNCH_TICKET_DENIED:'ขอตั๋วเข้าเกม Roblox ไม่สำเร็จ กรุณาตรวจเซสชันใน RAM แล้วลองเปิดเกมอีกครั้ง',
 GAME_LAUNCH_NETWORK_UNAVAILABLE:'เชื่อมต่อ Roblox เพื่อเปิดเกมไม่สำเร็จ กรุณาลองกดเปิดเกมอีกครั้ง',
 GAME_LAUNCH_UNAVAILABLE:'เปิดเกม Roblox ไม่สำเร็จ กรุณาลองกดเปิดเกมอีกครั้ง',
 GAME_PLACE_INVALID:'รหัสแมพ (Place ID) ของออเดอร์ไม่ถูกต้อง',
 PRIVATE_TARGET_MISSING:'แมพนี้ยังไม่มีลิงก์ Private Server ใน RAM',
 PRIVATE_TARGET_DENIED:'เข้า Private Server ไม่ได้ (ลิงก์อาจหมดอายุหรือจำกัดสิทธิ์) กดเข้า Public Server แทนได้',
 PRIVATE_TARGET_ACCESS_UNAVAILABLE:'อ่านรหัสเข้า Private Server ไม่สำเร็จ กดเข้า Public Server แทนได้',
 PRIVATE_TARGET_REDIRECT_REJECTED:'ลิงก์ Private Server เปลี่ยนเส้นทางไม่ถูกต้อง',
 CREDENTIALS_UNAVAILABLE:'ยังอ่านข้อมูลบัญชีลูกค้าไม่ได้ กรุณาเปิดหน้าออเดอร์แล้วลองใหม่'
});
