
// const { describe } = require("node:test");
const { v4: uuidv4 } = require('uuid');
const productDDB = require('./productDDBApi.js')
const { deleteUser, createNewUserAndGetCredentials } = require('./identity.js');
const { loadBasicTenantIdentityConfig, loadPlatinumTenantIdentityConfig } = require('./configLoader.js')


const config = require('./config.json');
const PRODUCT_SHARED_TABLE = "Product-pooled";
const PRODUCT_PLATINUM_TABLE = `Product-${config.platinumTenant}`
const identityConfig = {};
const credentials = {};
const usersToCleanUp = {};

beforeAll(async () => {
    identityConfig.basic = await loadBasicTenantIdentityConfig();
    identityConfig.platinum = await loadPlatinumTenantIdentityConfig(config.platinumTenant);

    // basic tenant 1
    let result = await createNewUserAndGetCredentials(
        config.accountId,
        config.region,
        config.basicTenant1,
        identityConfig.basic.identityPoolId,
        identityConfig.basic.userPoolId,
        identityConfig.basic.clientId);

    credentials[config.basicTenant1] = result.credentials;
    usersToCleanUp[result.username] = result.userPoolId;

    // basic tenant 2
    result = await createNewUserAndGetCredentials(
        config.accountId,
        config.region,
        config.basicTenant2,
        identityConfig.basic.identityPoolId,
        identityConfig.basic.userPoolId,
        identityConfig.basic.clientId);

    credentials[config.basicTenant2] = result.credentials;
    usersToCleanUp[result.username] = result.userPoolId;

    // platinum tenant
    result = await createNewUserAndGetCredentials(
        config.accountId,
        config.region,
        config.platinumTenant,
        identityConfig.platinum.identityPoolId,
        identityConfig.platinum.userPoolId,
        identityConfig.platinum.clientId);

    credentials[config.platinumTenant] = result.credentials;
    usersToCleanUp[result.username] = result.userPoolId;
}, 10000);

afterAll(async () => {
    await Promise.all(Object.keys(usersToCleanUp).map(x => deleteUser(usersToCleanUp[x], x)));
});


describe("Basic tier tenant can", () => {
    test("perform CRUD on product for themself", async () => {
        const productId = uuidv4();

        // create
        let response = await productDDB.createProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant1, productId, "dummy data");
        expect(response).toBe(200);

        // read
        response = await productDDB.getProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant1, productId);
        expect(response).toEqual(
            expect.objectContaining({
                Item: expect.anything(),
            })
        );

        // update
        response = await productDDB.updateProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant1, productId);
        expect(response).toBe(200);

        // delete
        response = await productDDB.deleteProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant1, productId);
        expect(response).toBe(200);
    })

    test("NOT perform CRUD on product for different basic tier tenant", async () => {
        const productId = uuidv4();

        // create
        await expect(
            productDDB.createProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant2, productId, "dummy data")
        ).rejects.toThrow("AccessDeniedException");


        // read
        await expect(
            productDDB.getProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant2, productId)
        ).rejects.toThrow("AccessDeniedException");


        // update
        await expect(
            productDDB.updateProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant2, productId)
        ).rejects.toThrow("AccessDeniedException");

        // delete
        await expect(
            productDDB.deleteProduct(config.region, credentials[config.basicTenant1], PRODUCT_SHARED_TABLE, config.basicTenant2, productId)
        ).rejects.toThrow("AccessDeniedException");
    })

    test("NOT perform CRUD on product for platinum tier tenant", async () => {
        const productId = uuidv4();

        // create
        await expect(
            productDDB.createProduct(config.region, credentials[config.basicTenant1], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId, "dummy data")
        ).rejects.toThrow("AccessDeniedException");


        // read
        await expect(
            productDDB.getProduct(config.region, credentials[config.basicTenant1], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId)
        ).rejects.toThrow("AccessDeniedException");


        // update
        await expect(
            productDDB.updateProduct(config.region, credentials[config.basicTenant1], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId)
        ).rejects.toThrow("AccessDeniedException");

        // delete
        await expect(
            productDDB.deleteProduct(config.region, credentials[config.basicTenant1], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId)
        ).rejects.toThrow("AccessDeniedException");
    })
});

describe("Platinum tier tenant can", () => {
    test("perform CRUD on product for themself", async () => {
        const productId = uuidv4();

        // create
        let response = await productDDB.createProduct(config.region, credentials[config.platinumTenant], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId, "dummy data");
        expect(response).toBe(200);

        // read
        response = await productDDB.getProduct(config.region, credentials[config.platinumTenant], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId);
        expect(response).toEqual(
            expect.objectContaining({
                Item: expect.anything(),
            })
        );

        // update
        response = await productDDB.updateProduct(config.region, credentials[config.platinumTenant], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId);
        expect(response).toBe(200);

        // delete
        response = await productDDB.deleteProduct(config.region, credentials[config.platinumTenant], PRODUCT_PLATINUM_TABLE, config.platinumTenant, productId);
        expect(response).toBe(200);
    });

    test("NOT perform CRUD on product for a basic tier tenant", async () => {
        const productId = uuidv4();

        // create
        await expect(
            productDDB.createProduct(config.region, credentials[config.platinumTenant], PRODUCT_SHARED_TABLE, config.basicTenant1, productId, "dummy data")
        ).rejects.toThrow("AccessDeniedException");


        // read
        await expect(
            productDDB.getProduct(config.region, credentials[config.platinumTenant], PRODUCT_SHARED_TABLE, config.basicTenant1, productId)
        ).rejects.toThrow("AccessDeniedException");


        // update
        await expect(
            productDDB.updateProduct(config.region, credentials[config.platinumTenant], PRODUCT_SHARED_TABLE, config.basicTenant1, productId)
        ).rejects.toThrow("AccessDeniedException");

        // delete
        await expect(
            productDDB.deleteProduct(config.region, credentials[config.platinumTenant], PRODUCT_SHARED_TABLE, config.basicTenant1, productId)
        ).rejects.toThrow("AccessDeniedException");
    });
});

