# GVA24 — Gestion de relais 24h

Application web collaborative temps-réel pour gérer les relais de la course de
24h (samedi 13 juin 2026 12h30 → dimanche 14 juin 12h00, modifiable dans l'app, boucle de 7 km, 9 coureurs en
rotation). Mobile-first, multi-utilisateurs, auto-hébergée : un seul conteneur
Docker, base de données locale (fichiers JSON), temps réel via Server-Sent
Events. **Aucun service externe.**

## Démarrage avec Docker (recommandé)

```bash
docker compose up -d --build
```

C'est tout : au premier démarrage le serveur crée automatiquement la course
(code **2424**, 9 coureurs, planning complet). Le conteneur écoute en interne
sur 8787, exposé sur l'hôte via le port **5175** (mapping `5175:8787` dans
`docker-compose.yml`, modifiable). La base de données vit dans
`./data/race-2424.json` (volume), elle survit aux redémarrages et mises à
jour du conteneur.

Vérification : `curl http://localhost:5175/api/race/2424` ou ouvrir
<http://localhost:5175> et entrer le code 2424.

Variables d'environnement (dans `docker-compose.yml`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `RACE_PIN` | `2424` | code de la course créée au premier démarrage |
| `PORT` | `8787` | port d'écoute interne du conteneur (le port hôte se règle dans `ports:`) |
| `DATA_DIR` | `/data` | dossier de la base de données |

Remise à zéro complète : bouton *Administration → Réinitialiser* dans l'app
(avec sauvegarde restaurable), ou `npm run seed -- 2424` (réécrit la course),
ou supprimer `./data/race-2424.json` et redémarrer le conteneur.

## Reverse proxy — Nginx Proxy Manager

Dans NPM, *Hosts → Proxy Hosts → Add Proxy Host* :

| Champ | Valeur |
|---|---|
| **Domain Names** | `gva24.mondomaine.tld` (votre sous-domaine) |
| **Scheme** | `http` |
| **Forward Hostname / IP** | IP de la machine Docker (ex: `192.168.1.10`) — ou `gva24` si NPM est sur le même réseau Docker |
| **Forward Port** | `5175` (ou `8787` si NPM joint le conteneur directement par son nom sur le réseau Docker) |
| **Cache Assets** | désactivé |
| **Block Common Exploits** | activé |
| **Websockets Support** | **activé** (nécessaire au flux temps réel) |

Onglet *SSL* : certificat Let's Encrypt + *Force SSL* si le domaine est exposé.

Notes :
- le temps réel utilise SSE (EventSource) ; le serveur envoie l'en-tête
  `X-Accel-Buffering: no` et un heartbeat toutes les 25 s, donc aucune
  configuration nginx supplémentaire n'est requise ;
- si NPM tourne aussi en Docker sur la même machine, le plus simple est de
  mettre les deux sur un réseau commun :
  `docker network connect <réseau_de_npm> gva24`, puis Forward Hostname =
  `gva24`.

## Développement local (sans Docker)

```bash
npm install
npm run dev:server    # backend sur :8787 (crée la course au 1er lancement)
npm run dev           # front Vite sur :5173 (proxy /api → :8787)
```

En production sans Docker : `npm run build && npm start`.

## Les 4 écrans

| Route | Écran | Usage |
|---|---|---|
| `/` | **Dashboard** | Horloge + chrono course, coureur en cours (timer live ou décompte de transition), suivant, 8 prochains passages, progression, administration (horaires de course, reset/restore) |
| `/timeline` | **Timeline** | Tous les tours, prévu vs réel, écart coloré, filtre par coureur, saisie inline des temps réels |
| `/runners` | **Coureurs** | Fiche par coureur : allure base vs réelle, historique des tours, modification de l'allure de base |
| `/quick` | **Saisie rapide** | Vue coureur : « TON PROCHAIN TOUR », gros bouton **J'ARRIVE**, décompte de transition, saisie manuelle |

Codes couleur timeline : gris = à venir, bleu = en course, vert = terminé dans
les temps (±1 min), orange = en retard (> +1 min), rouge = en avance (> −1 min).

## Architecture

```
téléphones (React SPA)
   │  GET /api/race/2424            état complet au chargement
   │  GET /api/race/2424/events     SSE : état rediffusé à chaque changement
   │  POST /api/race/2424/action    {type: start|finish|edit|basePace|reset|restore}
   ▼
serveur Node (dist-server/index.mjs, zéro dépendance runtime)
   │  applique l'action pure + recalcul en cascade (src/lib/race.ts,
   │  code partagé avec le front), en série → pas de conflit d'écriture
   ▼
base de données locale : data/race-2424.json (écriture atomique tmp+rename)
```

### Le recalcul en cascade (`src/lib/race.ts`)

1. **Allure réelle** de chaque coureur = moyenne pondérée des allures de ses
   tours terminés, les tours récents pesant plus lourd (poids 1, 2, 3, …).
   Sans tour terminé : allure de base.
2. **Parcours chronologique** des tours avec un curseur temporel :
   - tour **terminé** : prédictions figées, le curseur saute à `actualEnd` ;
   - tour **en cours** : le curseur saute à la projection
     `actualStart + allure_actuelle × 7 km`, bornée à « maintenant » ;
   - tour **à venir** : `predictedStart = curseur`, durée à l'allure actuelle ;
   - après chaque tour, le curseur avance de la transition (20 s).
3. **Fin de course** : on génère des tours tant que `predictedStart < 12h00` ;
   le planning s'allonge ou se raccourcit selon le rythme réel de l'équipe.

### Règles de terrain

- **enchaînement automatique** : terminer un tour (« Terminer », **J'ARRIVE**
  ou saisie manuelle de l'arrivée) lance le décompte de 20 s (passage de la
  balise) puis le tour suivant démarre tout seul (départ réel = arrivée + 20 s).
  « Démarrer » ne sert qu'au départ de la course ;
- les départs réels étant dérivés du passage de balise, **corriger une
  arrivée dans la Timeline corrige aussi le départ réel du tour suivant**
  (+20 s) et recalcule sa durée s'il est terminé ;
- un seul tour « en course » à la fois ; **J'ARRIVE** sans départ enregistré
  retombe sur le départ prévu ;
- tout est corrigeable a posteriori dans la Timeline (heure de Paris, champ
  vide + OK pour effacer).

### Reset / restore (Dashboard → Administration)

- **Réinitialiser la course** : efface les temps réels, remet les allures de
  base, régénère le planning — l'état courant est d'abord sauvegardé ;
- **Restaurer la dernière session** : remet la course dans l'état d'avant le
  dernier reset (essais de la veille, fausse manip…).

## Données & conventions

- Durées en secondes entières, timestamps ISO 8601 UTC ; affichage en heure
  de Paris (`Intl.DateTimeFormat`, gère l'heure d'été) ;
- timers du dashboard : `setInterval` local d'une seconde, aucun polling
  réseau — le temps réel vient du flux SSE ;
- hors ligne : bandeau « Hors ligne — données locales », l'`EventSource` se
  reconnecte automatiquement, toast rouge si une écriture échoue.

## Arborescence

```
├── Dockerfile / docker-compose.yml / .dockerignore
├── server/index.ts             # HTTP + SSE + persistance JSON + statique
├── scripts/seed.mjs            # re-crée la course via l'API (npm run seed)
└── src/
    ├── lib/
    │   ├── types.ts            # modèle de données
    │   ├── race.ts             # ★ logique métier partagée front/serveur
    │   ├── seedData.ts         # course initiale (9 coureurs, allures)
    │   ├── time.ts             # fuseaux, formats, parsing d'heures
    │   └── useNow.ts           # horloge 1 s
    ├── store/raceStore.ts      # Zustand + fetch/EventSource + statut réseau
    ├── components/             # Layout, JoinGate (PIN), TimeEdit
    └── pages/                  # Dashboard, Timeline, Runners, RunnerDetail, QuickEntry
```

## Commandes

| Commande | Effet |
|---|---|
| `docker compose up -d --build` | build + lance le conteneur (app prête sur :8787) |
| `npm run seed -- <PIN>` | (re)crée la course sous ce code — écrase l'existant |
| `npm run dev` / `npm run dev:server` | développement front / backend |
| `npm run build` | typecheck + build client (`dist/`) + serveur (`dist-server/`) |
| `npm start` | lance le serveur de production en local |
