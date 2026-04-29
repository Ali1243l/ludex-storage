export interface Subscription {
  id: string;
  name: string;
  activationDate?: string;
  expirationDate?: string;
  notes: string;
  category: string;
  account_username?: string;
  account_password?: string;
  created_at?: string;
  status?: string;
  sell_count?: number;
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
  created_at?: string;
}

export interface Purchase {
  id: string;
  date: string;
  details: string;
}

export interface Customer {
  id: string;
  customer_number?: number;
  customer_code?: string;
  name: string;
  username: string;
  purchases: Purchase[];
  notes: string;
  total_spent?: number;
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
  customerCode?: string;
  date: string;
  productName: string;
  price: number;
  notes: string;
  productLink?: string;
  created_at?: string;
}

export interface Supplier {
  id: string;
  name: string;
  profile_link: string;
  notes: string;
  created_at?: string;
}
