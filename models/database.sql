-- Create the database
CREATE DATABASE IF NOT EXISTS lost_found_db;
USE lost_found_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    user_type ENUM('individual', 'organization') DEFAULT 'individual',
    organization_name VARCHAR(255),
    profile_image VARCHAR(255),
    notifications_email TINYINT(1) DEFAULT 1,
    notifications_sms TINYINT(1) DEFAULT 0,
    notifications_whatsapp TINYINT(1) DEFAULT 0,
    privacy_public TINYINT(1) DEFAULT 1,
    privacy_show_phone TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_en VARCHAR(100) NOT NULL,
    name_rw VARCHAR(100),
    name_fr VARCHAR(100),
    name_sw VARCHAR(100),
    icon VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Items table
CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT NOT NULL,
    type ENUM('lost', 'found') NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    document_number VARCHAR(100),
    owner_name_on_doc VARCHAR(255),
    country VARCHAR(100),
    city VARCHAR(100),
    specific_location VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    date_lost_found DATE,
    time_lost_found TIME,
    image_url VARCHAR(255),
    image_url_2 VARCHAR(255),
    image_url_3 VARCHAR(255),
    is_reward_offered BOOLEAN DEFAULT FALSE,
    reward_amount DECIMAL(10, 2),
    contact_method ENUM('all', 'email', 'phone') DEFAULT 'all',
    status ENUM('active', 'resolved', 'returned') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lost_item_id INT NOT NULL,
    found_item_id INT NOT NULL,
    match_score INT DEFAULT 0,
    status ENUM('pending', 'confirmed', 'rejected') DEFAULT 'pending',
    match_type ENUM('auto', 'manual') DEFAULT 'auto',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lost_item_id) REFERENCES items(id),
    FOREIGN KEY (found_item_id) REFERENCES items(id)
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    item_title VARCHAR(255) NOT NULL,
    item_type ENUM('lost','found') NOT NULL,
    user_one_id INT NOT NULL,
    user_two_id INT NOT NULL,
    user_one_name VARCHAR(255) NOT NULL,
    user_two_name VARCHAR(255) NOT NULL,
    last_message TEXT,
    last_sender_id INT,
    typing_user_id INT DEFAULT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id),
    FOREIGN KEY (user_one_id) REFERENCES users(id),
    FOREIGN KEY (user_two_id) REFERENCES users(id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id INT NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    content TEXT DEFAULT NULL,
    image_url VARCHAR(255) DEFAULT NULL,
    reply_to_message_id INT DEFAULT NULL,
    reactions JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (reply_to_message_id) REFERENCES messages(id)
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    related_item_id INT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Insert default categories
INSERT INTO categories (name_en, name_rw, name_fr, name_sw, icon) VALUES
('ID Card', 'Ikarita', 'Carte d\'identité', 'Kitambulisho', '📇'),
('Passport', 'Passiporo', 'Passeport', 'Pasipoti', '🛂'),
('Driving License', 'Livret ya Conduire', 'Permis de conduire', 'Leseni ya kuendesha', '🚗'),
('Phone', 'Telefoni', 'Téléphone', 'Simu', '📱'),
('Wallet', 'Bokkusu', 'Portefeuille', 'Pochi', '👛'),
('Key', 'Ufu', 'Clé', 'Ufunguo', '🔑'),
('Bag', 'Sakwe', 'Sac', 'Mfumo', '👜'),
('Clothing', 'Imyenda', 'Vêtements', 'Mavazi', '👕'),
('Electronics', 'Ebikomputera', 'Électronique', 'Vifaa vya elektroniki', '💻'),
('Other', 'Ikindi', 'Autre', 'Mwingine', '📦');

-- Create indexes for better performance
CREATE INDEX idx_items_type ON items(type);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_matches_lost ON matches(lost_item_id);
CREATE INDEX idx_matches_found ON matches(found_item_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);