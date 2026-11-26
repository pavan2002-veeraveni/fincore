import bcrypt from 'bcrypt';
import { getDb, closeDb } from './connection.js';
import { ledgerService } from '../../modules/ledger/ledger.service.js';
import { logger } from '../logger/index.js';
import { SYSTEM_CLEARING_WALLET_ID } from './migrations/004_system_accounts_and_hardening.js';

const SEED_PASSWORD = 'FinCore@2026!';

interface SeedUserSpec {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  roles: string[];
  createWallet?: {
    walletName: string;
    initialBalanceMinor: number;
  };
}

const SEED_USERS: SeedUserSpec[] = [
  {
    email: 'customer1@fincore.test',
    firstName: 'Aarav',
    lastName: 'Sharma',
    phoneNumber: '+919876543210',
    roles: ['CUSTOMER'],
    createWallet: {
      walletName: 'Aarav Primary INR Wallet',
      initialBalanceMinor: 5_000_000, // ₹50,000.00
    },
  },
  {
    email: 'customer2@fincore.test',
    firstName: 'Priya',
    lastName: 'Nair',
    phoneNumber: '+919876543211',
    roles: ['CUSTOMER'],
    createWallet: {
      walletName: 'Priya Primary INR Wallet',
      initialBalanceMinor: 1_500_000, // ₹15,000.00
    },
  },
  {
    email: 'support@fincore.test',
    firstName: 'Rohan',
    lastName: 'Verma',
    phoneNumber: '+919876543212',
    roles: ['SUPPORT_AGENT'],
  },
  {
    email: 'analyst@fincore.test',
    firstName: 'Meera',
    lastName: 'Iyer',
    phoneNumber: '+919876543213',
    roles: ['OPERATIONS_ANALYST'],
  },
  {
    email: 'finance@fincore.test',
    firstName: 'Vikram',
    lastName: 'Kapoor',
    phoneNumber: '+919876543214',
    roles: ['FINANCE_ADMIN'],
  },
  {
    email: 'admin@fincore.test',
    firstName: 'Ananya',
    lastName: 'Patel',
    phoneNumber: '+919876543215',
    roles: ['PLATFORM_ADMIN'],
  },
];

export async function runSeed(): Promise<void> {
  const db = getDb();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  await db.transaction(async (trx) => {
    const createdWallets = new Map<string, { userId: string; customerId: string; walletId: string }>();

    for (const spec of SEED_USERS) {
      let user = await trx('users').where({ email: spec.email }).first();
      if (!user) {
        [user] = await trx('users')
          .insert({
            email: spec.email,
            password_hash: passwordHash,
            first_name: spec.firstName,
            last_name: spec.lastName,
            phone_number: spec.phoneNumber,
            status: 'ACTIVE',
          })
          .returning('*');
      }

      for (const roleName of spec.roles) {
        const role = await trx('roles').where({ name: roleName }).first();
        if (role) {
          await trx('user_roles')
            .insert({ user_id: user.id, role_id: role.id })
            .onConflict(['user_id', 'role_id'])
            .ignore();
        }
      }

      let profile = await trx('customer_profiles').where({ user_id: user.id }).first();
      if (!profile) {
        [profile] = await trx('customer_profiles')
          .insert({
            user_id: user.id,
            display_name: `${spec.firstName} ${spec.lastName}`,
            city: 'Bengaluru',
            state: 'Karnataka',
            country: 'IN',
            identity_status: 'VERIFIED',
            identity_verified_at: new Date(),
          })
          .returning('*');
      }

      if (spec.createWallet) {
        let wallet = await trx('wallets')
          .where({ customer_id: profile.id, wallet_name: spec.createWallet.walletName })
          .first();

        if (!wallet) {
          [wallet] = await trx('wallets')
            .insert({
              customer_id: profile.id,
              wallet_name: spec.createWallet.walletName,
              currency: 'INR',
              status: 'ACTIVE',
              wallet_type: 'CUSTOMER',
              ledger_balance_minor: 0,
              available_balance_minor: 0,
            })
            .returning('*');

          await ledgerService.postBalancedJournal(trx, {
            type: 'DEPOSIT',
            currency: 'INR',
            description: `Synthetic initial seed deposit for ${spec.email}`,
            postedBy: user.id,
            entries: [
              { walletId: SYSTEM_CLEARING_WALLET_ID, entryType: 'DEBIT', amountMinor: spec.createWallet.initialBalanceMinor },
              { walletId: wallet.id, entryType: 'CREDIT', amountMinor: spec.createWallet.initialBalanceMinor },
            ],
          });
        }

        createdWallets.set(spec.email, {
          userId: user.id,
          customerId: profile.id,
          walletId: wallet.id,
        });
      }
    }

    const c1 = createdWallets.get('customer1@fincore.test');
    const c2 = createdWallets.get('customer2@fincore.test');

    if (c1 && c2) {
      // Seed beneficiary from customer1 -> customer2
      const existingBenef = await trx('beneficiaries')
        .where({ owner_customer_id: c1.customerId, destination_wallet_id: c2.walletId })
        .first();
      if (!existingBenef) {
        await trx('beneficiaries').insert({
          owner_customer_id: c1.customerId,
          destination_wallet_id: c2.walletId,
          nickname: 'Priya Primary Wallet',
          status: 'ACTIVE',
        });
      }

      // Seed one sample completed transfer if none exist
      const existingTransfer = await trx('transfers')
        .where({ source_wallet_id: c1.walletId, destination_wallet_id: c2.walletId })
        .first();

      if (!existingTransfer) {
        const [transfer] = await trx('transfers')
          .insert({
            source_wallet_id: c1.walletId,
            destination_wallet_id: c2.walletId,
            amount_minor: 100_000, // ₹1,000.00
            currency: 'INR',
            status: 'COMPLETED',
            description: 'Simulated sample rent split transfer',
            initiated_by: c1.userId,
            confirmed_at: new Date(),
            completed_at: new Date(),
          })
          .returning('*');

        const { journal } = await ledgerService.postBalancedJournal(trx, {
          type: 'TRANSFER',
          currency: 'INR',
          description: 'Simulated sample rent split transfer',
          referenceId: transfer.id,
          referenceType: 'TRANSFER',
          postedBy: c1.userId,
          entries: [
            { walletId: c1.walletId, entryType: 'DEBIT', amountMinor: 100_000 },
            { walletId: c2.walletId, entryType: 'CREDIT', amountMinor: 100_000 },
          ],
        });

        await trx('transfers').where({ id: transfer.id }).update({ journal_transaction_id: journal.id });

        // Seed sample open dispute for support agent review
        await trx('disputes').insert({
          customer_id: c1.customerId,
          transfer_id: transfer.id,
          reason: 'Simulated duplicate charge inquiry (educational fixture)',
          description: 'Customer requested simulated clarification on transfer timing.',
          status: 'OPEN',
        });
      }
    }
  });

  logger.info('FinCore synthetic seed data applied cleanly');
}

// Execute when run directly via tsx src/infrastructure/database/seed.ts
const isDirectRun = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isDirectRun) {
  runSeed()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Seed failed');
      process.exit(1);
    });
}
