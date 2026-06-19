-- Add optional product metadata for future quick logging and supermarket-based search.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS usual_serving TEXT;
