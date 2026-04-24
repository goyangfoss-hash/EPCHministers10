-- ══════════════════════════════════════════════════════════════
--  근무표 앱 v9 — Supabase SQL 설정
--  기존 테이블이 있어도 안전하게 실행됩니다.
-- ══════════════════════════════════════════════════════════════

-- ┌──────────────────────────────────────────────┐
-- │  완전 재설치 시에만 주석 해제 후 실행             │
-- └──────────────────────────────────────────────┘
/*
DROP TABLE IF EXISTS public.comment_likes    CASCADE;
DROP TABLE IF EXISTS public.shift_comments   CASCADE;
DROP TABLE IF EXISTS public.feed_posts       CASCADE;
DROP TABLE IF EXISTS public.notice_reads     CASCADE;
DROP TABLE IF EXISTS public.notices          CASCADE;
DROP TABLE IF EXISTS public.schedules        CASCADE;
DROP TABLE IF EXISTS public.app_users        CASCADE;
*/

-- 1. 회원 테이블
CREATE TABLE IF NOT EXISTS public.app_users (
  id         BIGSERIAL   PRIMARY KEY,
  name       TEXT        NOT NULL,
  phone      TEXT        NOT NULL,
  birth      TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'employee'
             CHECK (role IN ('employee','admin','superadmin')),
  status     TEXT        NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS memo TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS app_users_name_phone_uidx ON public.app_users (name, phone);

-- 2. 근무표 테이블 (월별 1행 누적)
--  data: { "이름": { "날짜": "근무유형" }, ... }
CREATE TABLE IF NOT EXISTS public.schedules (
  id         BIGSERIAL   PRIMARY KEY,
  year       INT         NOT NULL,
  month      INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT      REFERENCES public.app_users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS schedules_year_month_uidx ON public.schedules (year, month);

-- 3. 공지 테이블
CREATE TABLE IF NOT EXISTS public.notices (
  id         BIGSERIAL   PRIMARY KEY,
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  created_by BIGINT      REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.notice_reads (
  notice_id  BIGINT NOT NULL REFERENCES public.notices(id)   ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

-- 4. 피드 테이블
CREATE TABLE IF NOT EXISTS public.feed_posts (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  is_private  BOOLEAN     NOT NULL DEFAULT true,
  admin_reply TEXT,
  replied_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. 댓글 테이블
CREATE TABLE IF NOT EXISTS public.shift_comments (
  id         BIGSERIAL   PRIMARY KEY,
  year       INT         NOT NULL,
  month      INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
  day        INT         NOT NULL CHECK (day   BETWEEN 1 AND 31),
  user_id    BIGINT      NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_comments_ym_idx ON public.shift_comments (year, month);

-- 6. 좋아요 테이블
CREATE TABLE IF NOT EXISTS public.comment_likes (
  comment_id BIGINT NOT NULL REFERENCES public.shift_comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES public.app_users(id)      ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- RLS 활성화
ALTER TABLE public.app_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_reads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_posts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "anon_all" ON public.app_users;
  DROP POLICY IF EXISTS "anon_all" ON public.schedules;
  DROP POLICY IF EXISTS "anon_all" ON public.notices;
  DROP POLICY IF EXISTS "anon_all" ON public.notice_reads;
  DROP POLICY IF EXISTS "anon_all" ON public.feed_posts;
  DROP POLICY IF EXISTS "anon_all" ON public.shift_comments;
  DROP POLICY IF EXISTS "anon_all" ON public.comment_likes;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "anon_all" ON public.app_users      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.schedules      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.notices        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.notice_reads   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.feed_posts     FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.shift_comments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.comment_likes  FOR ALL TO anon USING (true) WITH CHECK (true);

-- 관리자 계정
INSERT INTO public.app_users (name, phone, birth, role, status)
VALUES ('김동권', '0932', '890726', 'admin', 'approved')
ON CONFLICT (name, phone)
DO UPDATE SET role = 'admin', status = 'approved';

-- ══════════════════════════════════════════════════
--  ★ 핵심 설정: REPLICA IDENTITY FULL
--
--  이 설정이 없으면 Supabase Realtime 이벤트에서
--  payload.new.data (JSONB) 가 NULL로 전달되어
--  근무표가 빈 값이 됩니다.
--  반드시 실행하세요.
-- ══════════════════════════════════════════════════
ALTER TABLE public.schedules      REPLICA IDENTITY FULL;
ALTER TABLE public.app_users      REPLICA IDENTITY FULL;
ALTER TABLE public.shift_comments REPLICA IDENTITY FULL;
ALTER TABLE public.notices        REPLICA IDENTITY FULL;
ALTER TABLE public.feed_posts     REPLICA IDENTITY FULL;

-- Realtime Publication 활성화
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['schedules','app_users','shift_comments','notices','feed_posts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '실시간 설정 오류: %. 대시보드 → Database → Replication 에서 수동 활성화하세요.', SQLERRM;
END $$;

-- ══════════════════════════════════════════════════
--  확인 쿼리 (아래를 별도로 실행)
-- ══════════════════════════════════════════════════
-- 회원 확인:        SELECT id, name, role, status FROM public.app_users;
-- 근무표 확인:      SELECT year, month, updated_at FROM public.schedules ORDER BY year, month;
-- Realtime 확인:    SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';
-- REPLICA 확인:     SELECT relname, relreplident FROM pg_class
--                   WHERE relname IN ('schedules','app_users') AND relkind='r';
--                   -- relreplident = 'f' 이면 FULL 모드 (정상)
