export interface Subscription {
  id: string;
  name: string;
  activationDate?: string;
  expirationDate?: string;
  notes: string;
  category: string;
  account_username?: string;
  account_password?: string;
}

export type TransactionType = 'expense' | 'income';

export interface Transaction {
  id: string;
  type: TransactionType;
  person: string;
  username?: string;
  description: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface Purchase {
  id: string;
  date: string;
  details: string;
}

export interface Customer {
  id: string;
  customer_number?: number;
  name: string;
  username: string;
  purchases: Purchase[];
  notes: string;
}

export interface PriceTier {
  id: string;
  name: string;
  costPrice: number;
  sellingPrice: number;
  duration?: string;
}

export interface Product {
  id: string;
  name: string;
  costPrice: number;
  supplier: string;
  sellingPrice: number;
  notes: string;
  productLink?: string;
  category?: string;
  type?: string;
  priceTiers?: PriceTier[];
}

export interface SaleRecord {
  id: string;
  customerName: string;
  customerUsername: string;
  date: string;
  productName: string;
  price: number;
  notes: string;
  productLink?: string;
}

export interface Supplier {
  id: string;
  name: string;
  profile_link: string;
  notes: string;
  created_at?: string;
}
