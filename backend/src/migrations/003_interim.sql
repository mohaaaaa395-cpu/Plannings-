-- ---------------------------------------------------------------
-- Intérimaires.
-- Un intérimaire est un salarié « renfort » : il n'a pas les clés et
-- ne peut JAMAIS rester seul dans le magasin. Le moteur ne lui confie
-- donc ni l'ouverture, ni la fermeture, ni le comblement d'un creux :
-- seuls les permanents tiennent le magasin, l'intérimaire n'étant placé
-- que pendant les heures où un permanent est présent.
-- ---------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_temp BOOLEAN NOT NULL DEFAULT false;
