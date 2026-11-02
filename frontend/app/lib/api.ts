// Adresse du backend, lue dans frontend/.env.local (une seule source de vérité)
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";