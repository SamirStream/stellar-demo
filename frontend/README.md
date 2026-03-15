# The Signal — Stellar Escrow Demo

Frontend React de la démo d'escrow décentralisé sur **Stellar Soroban Testnet**.
Contrats à jalons, routage de frais atomique, réputation on-chain.

---

## Stack

| Couche | Technologie |
| --- | --- |
| UI | React 19 + TypeScript + Vite |
| Style | Tailwind CSS v4 (`@theme` block) |
| Chain | Stellar / Soroban Testnet |
| SDK Stellar | `@stellar/stellar-sdk` |
| Wallets (extension) | `@creit.tech/stellar-wallets-kit` — Freighter, Albedo |
| Wallets (embarqués) | `@privy-io/react-auth` — Email, Google, Twitter, Discord |

---

## Démarrage rapide

```bash
npm install
cp .env.example .env   # puis renseigner VITE_PRIVY_APP_ID (voir ci-dessous)
npm run dev
```

---

## Variables d'environnement

Créer un fichier `.env` à la racine du dossier `frontend/` :

```env
VITE_PRIVY_APP_ID=ton-privy-app-id-ici
```

> Sans `VITE_PRIVY_APP_ID`, le tab **Email / Social** affiche un avertissement mais le flow
> **Freighter / Albedo** reste entièrement fonctionnel.

---

## Configurer Privy (embedded wallets)

Privy permet aux utilisateurs de se connecter **sans extension de navigateur** via email ou compte social.
Un wallet Stellar Ed25519 auto-géré est créé côté client lors de la première connexion.

### 1. Créer un compte Privy

1. Aller sur **[https://privy.io](https://privy.io)** → **Start for free**
2. Créer un compte (GitHub ou email)

### 2. Créer une application

1. Dans le dashboard → **Create app**
2. Nom : `The Signal` (ou ce que tu veux)
3. Type d'app : **Web**

### 3. Récupérer l'App ID

1. Dashboard → ton app → **Settings** → **Basics**
2. Copier le champ **App ID** (`clz-xxxxxxxxxxxxxxxxxx`)
3. Coller dans `.env` :

   ```env
   VITE_PRIVY_APP_ID=clz-xxxxxxxxxxxxxxxxxx
   ```

### 4. Configurer les méthodes de login (optionnel)

Dans le dashboard → **Login methods**, activer :

- Email (OTP)
- Google
- Twitter / X
- Discord

> Les méthodes non-activées dans le dashboard n'apparaîtront pas dans le modal Privy,
> même si elles sont listées dans `loginMethods` du `PrivyProvider`.

### 5. Configurer le domaine autorisé

Dashboard → **Settings** → **Allowed origins** → ajouter :

- `http://localhost:5173` (dev)
- ton domaine de prod si déployé

---

## Architecture wallets

```text
Connect Wallet
├── Tab "Email / Social"  →  Privy modal
│     └── auth (Google / Twitter / Discord / Email OTP)
│           └── useCreateWallet({ chainType: 'stellar' })
│                 └── wallet Stellar Ed25519 embarqué
│                       └── signing : getStellarTxHash → signRawHash → assembleStellarSignedTx
│
└── Tab "Extension Wallet"  →  StellarWalletsKit modal
      ├── Freighter (extension Chrome/Firefox)
      └── Albedo (web-based, sans extension)
```

Les deux chemins exposent exactement la même interface `WalletState` via `useUnifiedWallet`.
Tous les composants (`DealDashboard`, `CreateDeal`, `SoroswapWidget`…) sont agnostiques de la source.

---

## Fichiers clés

```text
src/
├── hooks/
│   ├── useStellarWallet.ts    # Freighter / Albedo via StellarWalletsKit
│   ├── usePrivyWallet.ts      # Email / Social via Privy
│   ├── useUnifiedWallet.ts    # Merge des deux → WalletState unique
│   └── useDealEscrow.ts       # Appels contrats Soroban
├── lib/
│   ├── stellar.ts             # RPC URLs, helpers Stellar SDK
│   └── privy-stellar.ts       # Bridge signing Privy ↔ XDR Stellar
├── components/
│   └── WalletConnectModal.tsx # Modale 2 tabs (Privy + SWK)
└── App.tsx                    # Root — LiveTicker, navigation, handleConnect
```

---

## Commandes

```bash
npm run dev      # Serveur de développement (http://localhost:5173)
npm run build    # Build de production
npm run preview  # Prévisualiser le build
npx tsc --noEmit # Vérifier les types TypeScript
```

---

## Ressources

- [Stellar Soroban Docs](https://soroban.stellar.org)
- [Privy Docs — Stellar (Tier 2)](https://docs.privy.io/wallets/using-wallets/other-chains)
- [StellarWalletsKit](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
- [Stellar Explorer (Testnet)](https://stellar.expert/explorer/testnet)
