-- FaithFit platform: core schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  auth_provider TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  location TEXT,
  gloo_church_id TEXT,
  youversion_user_id TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE wearable_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  device_type TEXT,
  external_device_id TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE workouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  type TEXT,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  calories INT,
  avg_hr INT,
  max_hr INT,
  gps_route GEOGRAPHY,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE workout_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workout_id UUID REFERENCES workouts(id),
  event_type TEXT,
  timestamp TIMESTAMP,
  metadata JSONB
);

CREATE TABLE scripture_verses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference TEXT,
  text TEXT,
  translation TEXT,
  youversion_id TEXT,
  themes TEXT[],
  tags TEXT[],
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE scripture_themes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE,
  description TEXT
);

CREATE TABLE scripture_verse_themes (
  verse_id UUID REFERENCES scripture_verses(id),
  theme_id UUID REFERENCES scripture_themes(id),
  PRIMARY KEY (verse_id, theme_id)
);

CREATE TABLE scripture_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  verse_id UUID REFERENCES scripture_verses(id),
  trigger_type TEXT,
  biometric_snapshot JSONB,
  timestamp TIMESTAMP DEFAULT now()
);

CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  content TEXT,
  media_url TEXT,
  workout_id UUID REFERENCES workouts(id),
  verse_id UUID REFERENCES scripture_verses(id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE followers (
  follower_id UUID REFERENCES users(id),
  followee_id UUID REFERENCES users(id),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gloo_group_id TEXT,
  name TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE group_members (
  group_id UUID REFERENCES groups(id),
  user_id UUID REFERENCES users(id),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE user_xp (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  xp INT DEFAULT 0,
  level INT DEFAULT 1,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  description TEXT,
  icon_url TEXT
);

CREATE TABLE user_badges (
  user_id UUID REFERENCES users(id),
  badge_id UUID REFERENCES badges(id),
  earned_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  description TEXT,
  theme TEXT,
  difficulty INT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE user_quests (
  user_id UUID REFERENCES users(id),
  quest_id UUID REFERENCES quests(id),
  progress JSONB,
  completed BOOLEAN DEFAULT false,
  PRIMARY KEY (user_id, quest_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  type TEXT,
  payload JSONB,
  delivered_at TIMESTAMP
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action TEXT,
  metadata JSONB,
  timestamp TIMESTAMP DEFAULT now()
);
