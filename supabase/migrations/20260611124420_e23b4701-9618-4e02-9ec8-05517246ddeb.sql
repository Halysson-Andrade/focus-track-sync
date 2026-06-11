ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;
UPDATE public.profiles SET must_change_password = false WHERE created_at < now();