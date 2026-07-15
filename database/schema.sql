-- PostgreSQL Database Schema for Climbing Gym CRM

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PARENTS (אנשי קשר / הורים)
CREATE TABLE parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active', -- active, archived
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. EMPLOYEES (עובדים וצוות)
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    role VARCHAR(30) NOT NULL DEFAULT 'trainer', -- admin, manager, trainer, safety_officer
    payment_method VARCHAR(20) DEFAULT 'slip', -- slip (תלוש), invoice (חשבונית)
    bank_account_details TEXT,
    address TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    certifications TEXT[], -- list of certs (סנפלינג, מפעיל קיר, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. GROUPS (קבוצות וחוגים)
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_name VARCHAR(100) NOT NULL,
    day_of_week VARCHAR(10) NOT NULL, -- א, ב, ג, ד, ה, ו, ש
    start_time TIME NOT NULL,
    duration_minutes INTEGER DEFAULT 80, -- 50, 80, 110 min
    max_participants INTEGER DEFAULT 12,
    price_once_a_week NUMERIC(10, 2),
    price_twice_a_week NUMERIC(10, 2),
    parents_whatsapp_group_id VARCHAR(100),
    climbers_whatsapp_group_id VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    trainer_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    age_category VARCHAR(30), -- א-ב, ג-ד, ה-ו, חטיבה, תיכון, בוגרים
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. STUDENTS (מתאמנים/ילדים)
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_name VARCHAR(100) NOT NULL,
    birth_date DATE,
    parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    status VARCHAR(30) DEFAULT 'lead_new', -- lead_new, health_signed, intro_scheduled, registered, waitlist, archived
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_child_per_parent UNIQUE (student_name, parent_id)
);

-- 5. WAGE AGREEMENTS (הסכמי שכר)
CREATE TABLE wage_agreements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL, -- counter, class, private, event, route_building
    rate_per_hour NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_employee_activity UNIQUE (employee_id, activity_type)
);

-- 6. ATTENDANCE (נוכחות)
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL, -- attended (הגיע), absent (נעדר), intro_attended (אימון הכירות הגיע), intro_absent (אימון הכירות נעדר)
    trainer_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. LEVEL TESTS (מבחני רמה והובלה)
CREATE TABLE level_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    test_date DATE NOT NULL DEFAULT CURRENT_DATE,
    route_type VARCHAR(20) DEFAULT 'top_rope', -- top_rope (טופ רופ), lead (הובלה), pending (ממתין לשיבוץ)
    level_grade VARCHAR(20) NOT NULL, -- 5A, 5B, 5C, 6A, 6B, 6C, 7A, 7B, 7C, 8A
    status VARCHAR(20) DEFAULT 'pending', -- passed, failed, pending
    attended_ceremony BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. PRICELIST (מחירון)
CREATE TABLE pricelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_name VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    duration_hours NUMERIC(5, 2),
    description TEXT,
    category VARCHAR(50) NOT NULL, -- entry, card, subscription, private, rental, classes, camp, events, school
    ages VARCHAR(50) DEFAULT 'ללא הגבלה',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. CASH LEDGER (מעקב קופה)
CREATE TABLE cash_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    action_type VARCHAR(30) NOT NULL, -- emptying (ריקון), filling (מילוי), closing (סגירה), reset (איפוס)
    expected_amount NUMERIC(10, 2) NOT NULL,
    actual_amount NUMERIC(10, 2) NOT NULL,
    discrepancy NUMERIC(10, 2) GENERATED ALWAYS AS (actual_amount - expected_amount) STORED,
    notes TEXT,
    closed_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. SHIFT HOURS (שעות עובדים)
CREATE TABLE shift_hours (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out TIMESTAMP WITH TIME ZONE,
    activity_type VARCHAR(50) NOT NULL, -- counter_shift, class_shift, private_shift, event_shift, route_building_shift
    notes TEXT,
    status VARCHAR(20) DEFAULT 'open', -- open, closed
    approved_by_accounting BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. SAFETY INSPECTIONS (אישורי בטיחות)
CREATE TABLE safety_inspections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(100) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    inspection_type VARCHAR(20) NOT NULL, -- daily, weekly, monthly, annual
    description TEXT,
    completed_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    signature_file_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. BROADCAST LISTS (רשימות תפוצה)
CREATE TABLE broadcast_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    list_name VARCHAR(50) NOT NULL, -- hiking (טיולים), classes (חוגים), general (כללי)
    subscribed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_parent_list UNIQUE (parent_id, list_name)
);

-- 13. WHATSAPP SETTINGS (הגדרות וואטסאפ)
CREATE TABLE whatsapp_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. WHATSAPP LOGS (יומן הודעות וואטסאפ)
CREATE TABLE whatsapp_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL, -- inbound / outbound
    message TEXT,
    status VARCHAR(20) DEFAULT 'sent', -- sent, delivered, read, failed, received
    template_id VARCHAR(50),
    is_ai BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. BROADCAST CAMPAIGNS (היסטוריית דיוורים)
CREATE TABLE broadcast_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_name VARCHAR(100),
    list_name VARCHAR(50) NOT NULL,
    template_name VARCHAR(100),
    message_text TEXT,
    recipient_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'completed', -- pending, sending, completed, failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

