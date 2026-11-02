-- Premier nombre d'un texte : "24 m3/h (Normal) / 28 m3/h (Design)" → 24
CREATE OR REPLACE FUNCTION docspilot_num(txt TEXT) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    substring(replace(replace(coalesce(txt, ''), ' ', ''), ',', '.')
              from '(-?[0-9]+(?:\.[0-9]+)?)'),
    '')::DOUBLE PRECISION
$$;

-- Vue lue par l'agent : une ligne par pompe, une colonne par information
DROP VIEW IF EXISTS pompes_vue;
CREATE VIEW pompes_vue AS
WITH f AS (
  SELECT
    p.tag_name,
    p.created_at,
    p.marque_roulement,
    p.marque_garniture,
    p.existing_pump,
    p.full_json -> 'Identification'                AS ident,
    p.full_json -> 'Caracteristiques_du_produit'   AS produit,
    p.full_json -> 'Caracteristiques_hydrauliques' AS hydro,
    p.full_json -> 'Caracteristiques_mecaniques'   AS meca,
    p.full_json -> 'Materiau'                      AS mat
  FROM pump_extractions p
)
SELECT
  tag_name                                                     AS repere,
  NULLIF(trim(ident  -> 'Client'               ->> 'valeur'), '') AS client,
  NULLIF(trim(ident  -> 'pays du Client'       ->> 'valeur'), '') AS pays_client,
  NULLIF(trim(ident  -> 'Type_de_pompe'        ->> 'valeur'), '') AS type_pompe,
  NULLIF(trim(ident  -> 'Fonction'             ->> 'valeur'), '') AS fonction,
  NULLIF(trim(ident  -> 'Nombre_de_pompe'      ->> 'valeur'), '') AS nombre_pompes,
  NULLIF(trim(produit -> 'Nature_du_produit'   ->> 'valeur'), '') AS fluide,

  NULLIF(trim(produit -> 'Temperature'         ->> 'valeur'), '') AS temperature_texte,
  docspilot_num(produit -> 'Temperature'       ->> 'valeur')      AS temperature_c,
  NULLIF(trim(produit -> 'Densite'             ->> 'valeur'), '') AS densite_texte,
  docspilot_num(produit -> 'Densite'           ->> 'valeur')      AS densite,
  NULLIF(trim(produit -> 'Viscosite'           ->> 'valeur'), '') AS viscosite_texte,

  NULLIF(trim(hydro -> 'Debit_nominal'         ->> 'valeur'), '') AS debit_texte,
  CASE WHEN lower(hydro -> 'Debit_nominal' ->> 'valeur') LIKE '%l/s%'
       THEN docspilot_num(hydro -> 'Debit_nominal' ->> 'valeur') * 3.6
       ELSE docspilot_num(hydro -> 'Debit_nominal' ->> 'valeur')
  END                                                             AS debit_m3h,
  NULLIF(trim(hydro -> 'Hauteur_manometrique'  ->> 'valeur'), '') AS hauteur_texte,
  docspilot_num(hydro -> 'Hauteur_manometrique' ->> 'valeur')     AS hauteur_m,
  NULLIF(trim(hydro -> 'NPSH_disponible'       ->> 'valeur'), '') AS npsh_texte,
  docspilot_num(hydro -> 'NPSH_disponible'     ->> 'valeur')      AS npsh_m,
  NULLIF(trim(hydro -> 'Rendement'             ->> 'valeur'), '') AS rendement_texte,

  NULLIF(trim(meca -> 'Puissance_moteur'       ->> 'valeur'), '') AS puissance_moteur_texte,
  CASE WHEN (meca -> 'Puissance_moteur' ->> 'valeur') ~* '\mhp\M'
       THEN docspilot_num(meca -> 'Puissance_moteur' ->> 'valeur') * 0.7457
       ELSE docspilot_num(meca -> 'Puissance_moteur' ->> 'valeur')
  END                                                             AS puissance_moteur_kw,
  NULLIF(trim(meca -> 'Puissance_absorbee'     ->> 'valeur'), '') AS puissance_absorbee_texte,
  CASE WHEN (meca -> 'Puissance_absorbee' ->> 'valeur') ~* '\mhp\M'
       THEN docspilot_num(meca -> 'Puissance_absorbee' ->> 'valeur') * 0.7457
       ELSE docspilot_num(meca -> 'Puissance_absorbee' ->> 'valeur')
  END                                                             AS puissance_absorbee_kw,
  NULLIF(trim(meca -> 'Tension'                ->> 'valeur'), '') AS tension_texte,
  NULLIF(trim(meca -> 'Vitesse_rotation'       ->> 'valeur'), '') AS vitesse_texte,
  docspilot_num(meca -> 'Vitesse_rotation'     ->> 'valeur')      AS vitesse_rpm,
  NULLIF(trim(meca -> 'Norme'                  ->> 'valeur'), '') AS norme,
  NULLIF(trim(meca -> 'Etancheite'             ->> 'valeur'), '') AS etancheite,
  NULLIF(trim(meca -> 'Type_entrainement'      ->> 'valeur'), '') AS type_entrainement,
  NULLIF(trim(ident -> 'Marque_moteur'         ->> 'valeur'), '') AS marque_moteur,

  NULLIF(trim(mat -> 'Corps_de_la_pompe'       ->> 'valeur'), '') AS materiau_corps,
  NULLIF(trim(mat -> 'Impulseur'               ->> 'valeur'), '') AS materiau_impulseur,
  NULLIF(trim(mat -> 'Arbre'                   ->> 'valeur'), '') AS materiau_arbre,
  NULLIF(trim(mat -> 'Chemise'                 ->> 'valeur'), '') AS materiau_chemise,

  marque_roulement,
  marque_garniture,
  existing_pump                                                   AS pompe_existante,
  COALESCE(NULLIF(hydro -> 'Debit_nominal' ->> 'page', ''),
           ident -> 'Repere' ->> 'page')                          AS source,
  created_at                                                      AS date_extraction
FROM f;