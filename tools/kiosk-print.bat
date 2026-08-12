@echo off
REM ---------------------------------------------------------------------------
REM  מסוף הכניסה — הפעלה עם הדפסה שקטה
REM
REM  דפדפן, כברירת מחדל, פותח חלונית "הדפסה" ומחכה שמישהו ילחץ בה על הדפס.
REM  הדגל --kiosk-printing מבטל את החלונית הזאת: כל הדפסה יוצאת ישירות
REM  למדפסת ברירת המחדל של ווינדוס. זו הדרך היחידה להדפסה אוטומטית מדפדפן,
REM  ולכן המסוף חייב להיפתח מהקובץ הזה ולא מקיצור רגיל.
REM
REM  אין להוסיף כאן --disable-print-preview. הוא נוסה כדי להעלים חלון לבן
REM  שמבליח בכל הדפסה, ועשה נזק: --kiosk-printing פועל *בתוך* מנגנון התצוגה
REM  המקדימה של כרום, ולכן ביטול המנגנון מפיל את ההדפסה לחלונית של ווינדוס —
REM  בדיוק החלונית שכל הקובץ הזה קיים כדי להימנע ממנה. ההבהוב נשאר, ואין לו
REM  פתרון מהצד שלנו.
REM
REM  Edge ו-Chrome בנויים על אותו מנוע ומתנהגים אותו דבר. הקובץ מעדיף את
REM  Edge, שמותקן בכל מחשב ווינדוס, ונופל ל-Chrome אם Edge חסר.
REM
REM  פעם אחת לפני השימוש, בהגדרות ווינדוס:
REM    1. המדפסת התרמית מוגדרת כמדפסת ברירת המחדל.
REM    2. בהעדפות הדרייבר שלה — פתיחת מגירה בסוף ההדפסה, וגודל נייר 80 מ"מ.
REM    3. לכבות את "אפשר ל-Windows לנהל את מדפסת ברירת המחדל", אחרת ווינדוס
REM       יחליף אותה למדפסת האחרונה שהשתמשו בה.
REM ---------------------------------------------------------------------------
set "URL=https://app.kirboaz.co.il/checkin"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE%" (
  start "" "%EDGE%" --kiosk-printing --user-data-dir="%LOCALAPPDATA%\KirBoazTerminal" "%URL%"
) else if exist "%CHROME%" (
  start "" "%CHROME%" --kiosk-printing --user-data-dir="%LOCALAPPDATA%\KirBoazTerminal" "%URL%"
) else (
  echo לא נמצא Edge ולא Chrome במחשב הזה.
  pause
)
