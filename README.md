# GVA24 — Gestion de relais 24h

Application web collaborative temps-réel pour gérer les relais de la course de
24h (samedi 14 juin 2026 12h30 → dimanche 15 juin 2026 12h00, boucle de 7 km,
9 coureurs en rotation). Mobile-first, multi-utilisateurs, synchronisée en
direct via Firebase Realtime Database.

## Démarrage rapide (5 minutes le matin de la course)

Prérequis : Node.js ≥ 20 et un projet Firebase (gratuit, plan Spark).

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer Firebase
cp .env.example .env
#    → remplir .env avec les valeurs de la console Firebase
#      (console.firebase.google.com → votre projet → Paramètres → Vos applications → SDK)
#    → dans Realtime Database > Règles, coller le contenu de database.rules.json

# 3. Créer la course dans la base (9 coureurs + planning complet)
npm run seed -- 2424        # 2424 = code PIN à partager à l'équipe

# 4. Lancer en local
npm run dev                 # http://localhost:5173

# 5. Déployer sur Vercel (2 minutes)
npm i -g vercel
vercel --prod
#    → dans le dashboard Vercel, ajouter les 5 variables VITE_FIREBASE_*
#      (Settings > Environment Variables), puis redéployer si besoin.
```

Chaque membre de l'équipe ouvre l'URL sur son téléphone et entre le code
**2424**. Le code est mémorisé sur l'appareil (reconnexion automatique).

### Créer le projet Firebase (une seule fois, ~3 min)

1. <https://console.firebase.google.com> → *Ajouter un projet* (Analytics inutile).
2. *Créer une application Web* (`</>`), copier la config dans `.env`.
3. *Realtime Database* → *Créer une base* (mode verrouillé), puis onglet
   *Règles* → coller `database.rules.json` → *Publier*. Seul le chemin
   `races/<PIN>` est lisible/écrivable : le PIN fait office de code d'accès.

## Les 4 écrans

| Route | Écran | Usage |
|---|---|---|
| `/` | **Dashboard** | Horloge + chrono course, coureur en cours (timer live), suivant (compte à rebours), 5 prochains passages, progression, tours/km cumulés |
| `/timeline` | **Timeline** | Tous les tours, prévu vs réel, écart coloré, filtre par coureur, **saisie inline** des temps réels (corrections) |
| `/runners` | **Coureurs** | Fiche par coureur : allure base vs réelle, historique des tours, modification de l'allure de base |
| `/quick` | **Saisie rapide** | Vue coureur : « TON PROCHAIN TOUR », gros boutons **JE PARS** / **J'ARRIVE**, saisie manuelle en cas d'oubli |

Codes couleur timeline : gris = à venir, bleu = en course, vert = terminé dans
les temps (±1 min), orange = en retard (> +1 min), rouge = en avance (> −1 min).

## Le recalcul en cascade (algorithme)

Implémenté dans [`src/lib/race.ts`](src/lib/race.ts) (`recalcSchedule`), pur et
déterministe : tout le planning est reconstruit à partir de la config, des
temps réels saisis et des allures recalculées.

1. **Allure réelle** de chaque coureur = moyenne pondérée des allures de ses
   tours terminés, les tours récents pesant plus lourd (poids 1, 2, 3, …) pour
   suivre la fatigue. Sans tour terminé : allure de base.
2. **Parcours chronologique** des tours avec un curseur temporel initialisé au
   départ de la course (12h30) :
   - tour **terminé** : prédictions figées (la colonne « écart » reste
     comparable), le curseur saute à `actualEnd` ;
   - tour **en cours** : le curseur saute à la projection
     `actualStart + allure_actuelle × 7 km`, bornée à « maintenant » si le
     coureur est en retard sur sa projection ;
   - tour **à venir** : `predictedStart = curseur`,
     `predictedEnd = start + allure_actuelle × 7 km` — entièrement recalculé.
   - après chaque tour, le curseur avance de la transition (20 s).
3. **Fin de course** : on génère des tours tant que `predictedStart < 12h00`.
   Le dernier tour parti avant 12h00 est inclus même s'il finit après. Si
   l'équipe accélère, des tours apparaissent en fin de planning ; si elle
   ralentit, ils disparaissent.

Ainsi, terminer un tour (saisie de `actualEnd`) met à jour l'allure du coureur,
**tous ses tours futurs**, et **en cascade tous les horaires** des tours
suivants de toute l'équipe.

### Concurrence multi-téléphones

Chaque mutation (départ, arrivée, correction, changement d'allure) est une
**transaction Firebase** (`runTransaction`) sur le nœud `races/<PIN>` : action
pure + recalcul appliqués sur la dernière valeur serveur, écrits atomiquement.
Deux téléphones qui pointent simultanément ne peuvent pas s'écraser.

Règles de terrain encodées dans la logique :

- un seul tour « en course » à la fois : si le suivant appuie sur **JE PARS**
  alors que le précédent a oublié **J'ARRIVE**, le tour précédent est clôturé
  automatiquement (arrivée = nouveau départ − 20 s) ;
- **J'ARRIVE** sans **JE PARS** : le départ prévu sert de départ réel ;
- tout est corrigeable a posteriori dans la Timeline (saisie inline, heure de
  Paris, champ vide + OK pour effacer).

## Données & conventions techniques

- Durées en **secondes entières**, timestamps en **ISO 8601 UTC** ; affichage
  converti en heure de Paris (`Intl.DateTimeFormat`, gère l'heure d'été).
- Le timer du dashboard est un `setInterval` local d'une seconde — aucun
  polling réseau, le temps réel vient des websockets Firebase.
- Hors ligne : bandeau « Hors ligne — données locales » (`.info/connected`),
  les données restent affichées depuis le cache et se resynchronisent au
  retour du réseau ; toast rouge si une écriture échoue.
- Structure de la base :

```
races/<PIN>/
  config/        startTime, endTime, loopDistance_km, transitionTime_sec, runnerOrder[]
  runners/<id>/  name, basePace_secPerKm, currentPace_secPerKm
  laps/lapNNN/   runnerId, lapNumber, runnerLapNumber, status,
                 predictedStart_ts, predictedEnd_ts,
                 actualStart_ts, actualEnd_ts, actualDuration_sec
```

## Arborescence

```
├── scripts/seed.mjs            # initialisation de la course dans Firebase
├── database.rules.json         # règles de sécurité RTDB
├── vercel.json                 # rewrite SPA
└── src/
    ├── lib/
    │   ├── types.ts            # modèle de données
    │   ├── race.ts             # ★ logique métier : cascade, allures, actions
    │   ├── time.ts             # fuseaux, formats, parsing d'heures
    │   ├── firebase.ts         # init SDK
    │   └── useNow.ts           # horloge 1 s
    ├── store/raceStore.ts      # Zustand + transactions Firebase + statut réseau
    ├── components/             # Layout (nav + bandeaux), JoinGate (PIN), TimeEdit
    └── pages/                  # Dashboard, Timeline, Runners, RunnerDetail, QuickEntry
```

## Commandes

| Commande | Effet |
|---|---|
| `npm install` | installe les dépendances |
| `npm run seed -- <PIN>` | (re)crée la course sous `races/<PIN>` — écrase l'existant |
| `npm run dev` | serveur de dev <http://localhost:5173> |
| `npm run build` | vérification TypeScript + build de production dans `dist/` |
| `npm run preview` | sert le build localement |
| `vercel --prod` | déploiement production Vercel |
