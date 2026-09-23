พจนานุกรมซาเรเฟีย — PWA

• ลบปุ่มติดตั้งออกจากหน้าเว็บทั้งหมด
• ไม่มี beforeinstallprompt / install modal ในหน้าเว็บ
• โลโก้หน้าเว็บ, favicon, Apple Home Screen และ PWA manifest ใช้โลโก้จริงจาก URL เดิมใน HTML
• Vercel rewrite ทำให้โลโก้จริงอยู่ภายใต้ /icons/app-logo.png ซึ่งเป็น same-origin URL
• App Shortcuts:
  - ค้นหาคำศัพท์ → /?shortcut=search
  - ระบบควบคุม → /?shortcut=admin

ไฟล์ต้องอยู่ระดับ root เมื่อ deploy บน Vercel:
index.html
manifest.webmanifest
manifest.json
sw.js
vercel.json
