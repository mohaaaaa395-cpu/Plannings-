-- ---------------------------------------------------------------
-- Bornes horaires par salarié (contraintes dures).
-- Certains salariés habitent loin et ne peuvent pas ouvrir (arriver à
-- l'ouverture) ou fermer (rester jusqu'à la fermeture). On stocke une heure
-- d'arrivée au plus tôt et une heure de départ au plus tard : les fenêtres de
-- disponibilité de chaque jour sont bornées à cet intervalle, si bien que le
-- moteur n'affecte jamais l'ouverture/fermeture à quelqu'un qui ne peut pas
-- la tenir. NULL = pas de contrainte (peut ouvrir / fermer).
-- Ex. « dame du week-end » : latest_end = '18:40'.
-- ---------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS earliest_start TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS latest_end TEXT;
