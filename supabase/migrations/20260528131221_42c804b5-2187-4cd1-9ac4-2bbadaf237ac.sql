
-- 1) Goals defaults a 0 y reinicio del trigger handle_new_user
ALTER TABLE public.goals ALTER COLUMN kcal SET DEFAULT 0;
ALTER TABLE public.goals ALTER COLUMN protein SET DEFAULT 0;
ALTER TABLE public.goals ALTER COLUMN carbs SET DEFAULT 0;
ALTER TABLE public.goals ALTER COLUMN fat SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.goals (user_id, kcal, protein, carbs, fat)
    VALUES (NEW.id, 0, 0, 0, 0);
  RETURN NEW;
END;
$function$;

-- 2) Lista de la compra
CREATE TABLE public.shopping_list (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'ud',
  auto boolean NOT NULL DEFAULT false,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_list TO authenticated;
GRANT ALL ON public.shopping_list TO service_role;

ALTER TABLE public.shopping_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shopping_list all"
ON public.shopping_list
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER shopping_list_touch_updated_at
BEFORE UPDATE ON public.shopping_list
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_shopping_list_user ON public.shopping_list(user_id, done, created_at DESC);

-- 3) Planes de dieta guardados
CREATE TABLE public.diet_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  meals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.diet_plans TO authenticated;
GRANT ALL ON public.diet_plans TO service_role;

ALTER TABLE public.diet_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own diet_plans all"
ON public.diet_plans
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER diet_plans_touch_updated_at
BEFORE UPDATE ON public.diet_plans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_diet_plans_user ON public.diet_plans(user_id, created_at DESC);
