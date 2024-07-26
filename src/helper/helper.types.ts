
export interface StackDescription {
  applicationName: string;
  stackName: string;
}

export interface ProductInput {
  category: string;
  name: string;
  price: number;
  sku: string;
}

export interface Product extends ProductInput{
  productId: string;
}

export interface TenantProduct extends Product{
  tenantId: string;
}
export interface TenantCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export interface OrderInputLine {
  productId: string;
  quantity: number;
}

export interface OrderInput {
  lines: OrderInputLine[];
}

export interface Order extends OrderInput{
  orderId: string;
}

export interface OrderLine extends OrderInputLine{
  lineNumber: string;
  orderId: string;
}

export interface TenantOrderLine extends OrderLine{
  tenantId: string;
}

export interface User {
  email: string;
  userName: string;
  role: string;
}

export interface TenantUser extends User {
  tenantId: string;
  tier: string;
}

export interface TenantContext {
  tenantId: string;
  role: string;
  tier: string;
}
