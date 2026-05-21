-- =============================================
-- LOST AND FOUND APP - FULL DATABASE SCHEMA
-- =============================================

CREATE DATABASE IF NOT EXISTS lost_and_found_db;
USE lost_and_found_db;

-- Drop in correct FK order
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- =====================
-- USERS TABLE
-- =====================
CREATE TABLE users (
    id                 INT           AUTO_INCREMENT PRIMARY KEY,
    full_name          VARCHAR(100)  NOT NULL,
    email              VARCHAR(150)  NOT NULL UNIQUE,
    password           VARCHAR(255)  NOT NULL,
    phone              VARCHAR(20)   DEFAULT NULL,
    profile_image      VARCHAR(500)  DEFAULT NULL,
    country            VARCHAR(100)  DEFAULT NULL,
    city               VARCHAR(100)  DEFAULT NULL,
    preferred_language VARCHAR(10)   DEFAULT 'en',
    notifications_email TINYINT(1)    DEFAULT 1,
    notifications_sms   TINYINT(1)    DEFAULT 0,
    notifications_whatsapp TINYINT(1) DEFAULT 0,
    privacy_public      TINYINT(1)    DEFAULT 1,
    privacy_show_phone  TINYINT(1)    DEFAULT 0,
    user_type          ENUM('individual','police','organization','admin')
                                     DEFAULT 'individual',
    organization_name  VARCHAR(200)  DEFAULT NULL,
    is_verified        TINYINT(1)    DEFAULT 0,
    created_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =====================
-- CATEGORIES TABLE
-- =====================
CREATE TABLE categories (
    id       INT          AUTO_INCREMENT PRIMARY KEY,
    name_en  VARCHAR(100) NOT NULL,
    name_rw  VARCHAR(100) DEFAULT NULL,
    name_fr  VARCHAR(100) DEFAULT NULL,
    name_sw  VARCHAR(100) DEFAULT NULL,
    icon     VARCHAR(100) DEFAULT NULL
);

-- =====================
-- ITEMS TABLE
-- =====================
CREATE TABLE items (
    id                INT           AUTO_INCREMENT PRIMARY KEY,
    user_id           INT           NOT NULL,
    category_id       INT           DEFAULT NULL,
    type              ENUM('lost','found') NOT NULL,
    title             VARCHAR(200)  NOT NULL,
    description       TEXT          DEFAULT NULL,
    document_number   VARCHAR(100)  DEFAULT NULL,
    owner_name_on_doc VARCHAR(200)  DEFAULT NULL,
    country           VARCHAR(100)  DEFAULT NULL,
    city              VARCHAR(100)  DEFAULT NULL,
    specific_location VARCHAR(255)  DEFAULT NULL,
    latitude          DECIMAL(10,8) DEFAULT NULL,
    longitude         DECIMAL(11,8) DEFAULT NULL,
    date_lost_found   DATE          DEFAULT NULL,
    time_lost_found   TIME          DEFAULT NULL,
    image_url         VARCHAR(500)  DEFAULT NULL,
    image_url_2       VARCHAR(500)  DEFAULT NULL,
    image_url_3       VARCHAR(500)  DEFAULT NULL,
    is_reward_offered TINYINT(1)    DEFAULT 0,
    reward_amount     DECIMAL(10,2) DEFAULT NULL,
    contact_method    ENUM('phone','email','all') DEFAULT 'all',
    status            ENUM('active','resolved','returned','expired')
                                     DEFAULT 'active',
    created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- =====================
-- MATCHES TABLE
-- =====================
CREATE TABLE matches (
    id            INT          AUTO_INCREMENT PRIMARY KEY,
    lost_item_id  INT          NOT NULL,
    found_item_id INT          NOT NULL,
    match_score   DECIMAL(5,2) DEFAULT 0,
    match_type    ENUM('auto','manual') DEFAULT 'auto',
    status        ENUM('pending','confirmed','rejected','returned')
                               DEFAULT 'pending',
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_match (lost_item_id, found_item_id),
    FOREIGN KEY (lost_item_id)  REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (found_item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- =====================
-- NOTIFICATIONS TABLE
-- =====================
CREATE TABLE notifications (
    id              INT          AUTO_INCREMENT PRIMARY KEY,
    user_id         INT          NOT NULL,
    type            VARCHAR(50)  DEFAULT 'info',
    title           VARCHAR(200) NOT NULL,
    message         TEXT         NOT NULL,
    related_item_id INT          DEFAULT NULL,
    is_read         TINYINT(1)   DEFAULT 0,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================
-- SEED CATEGORIES
-- =====================
INSERT INTO categories (name_en, name_rw, name_fr, name_sw, icon) VALUES
('Identity Documents', 'Indangamuntu',   'Documents d''identité', 'Vitambulisho', '🪪'),
('Passport',           'Pasiporo',       'Passeport',             'Pasipoti',     '📘'),
('Driving License',    'Uruhushya',      'Permis de conduire',    'Leseni',       '🚗'),
('Phone',              'Telefoni',       'Téléphone',             'Simu',         '📱'),
('Wallet / Bag',       'Umufuko',        'Portefeuille / Sac',    'Mkoba',        '👜'),
('Keys',               'Indorerwamo',    'Clés',                  'Funguo',       '🔑'),
('Laptop / Electronics','Mudasobwa',     'Électronique',          'Elektroniki',  '💻'),
('Jewelry',            'Imikoreshereze', 'Bijoux',                'Mapambo',      '💍'),
('Clothing',           'Imyenda',        'Vêtements',             'Nguo',         '👕'),
('Animal / Pet',       'Inyamaswa',      'Animal',                'Mnyama',       '🐾'),
('Vehicle',            'Imodoka',        'Véhicule',              'Gari',         '🚙'),
('Other',              'Ibindi',         'Autre',                 'Nyingine',     '📦');