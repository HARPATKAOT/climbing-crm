-- שיבוץ ותשלום צוות לאירוע.
--
-- לכל אירוע אפשר להגדיר איזה תפקיד מותר לשבץ אליו (טיול סנפלינג — רק מדריכי
-- סנפלינג) ואיך משלמים: לפי התעריף האישי של העובד לאותו תפקיד, או תשלום
-- גלובלי בסכום שנקבע לאירוע הספציפי הזה.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS staff_role TEXT,
  ADD COLUMN IF NOT EXISTS staff_pay_mode TEXT,
  ADD COLUMN IF NOT EXISTS staff_flat_amount NUMERIC(10, 2);

ALTER TABLE activity_templates
  ADD COLUMN IF NOT EXISTS staff_role TEXT,
  ADD COLUMN IF NOT EXISTS staff_pay_mode TEXT,
  ADD COLUMN IF NOT EXISTS staff_flat_amount NUMERIC(10, 2);
