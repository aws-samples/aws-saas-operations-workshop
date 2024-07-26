const { v4: uuidv4 } = require('uuid');
const cognitoidp = require('@aws-sdk/client-cognito-identity-provider')
const cognitoidentity = require('@aws-sdk/client-cognito-identity')
const cognito = require('amazon-cognito-identity-js')

const cognitoIdpClient = new cognitoidp.CognitoIdentityProviderClient();
const idClient = new cognitoidentity.CognitoIdentityClient();

const createRandomPassword = () => {
    const password = uuidv4();
    const len = password.length;
    const mid = Math.floor(len / 2);
    return password.substring(0, mid) + password.substring(mid).toUpperCase();
};

const createUsername = (tenantId) => `TenantUser-${uuidv4()}`;

const createUserForTenant = async (tenantId, userPoolId) => {
    const username = createUsername(tenantId);
    const password = createRandomPassword();
    // const email = `${username}@nowhere.com`;

    let response = await cognitoIdpClient.send(new cognitoidp.AdminCreateUserCommand({
        Username: username,
        UserPoolId: userPoolId,
        UserAttributes: [
            // { Name: "email", Value: email },
            { Name: "custom:userRole", Value: "TenantUser" },
            { Name: "custom:tenantId", Value: tenantId }
        ],
    }));

    await cognitoIdpClient.send(new cognitoidp.AdminSetUserPasswordCommand({
        Username: username,
        Password: password,
        UserPoolId: userPoolId,
        Permanent: true
    }));

    return ({ username: username, password: password });
};

const deleteUser = async (userPoolId, username) => {
    await cognitoIdpClient.send(new cognitoidp.AdminDeleteUserCommand({
        Username: username,
        UserPoolId: userPoolId
    }));
};

const _internal_login = (username, password, userPoolId, clientId, resolve, reject) => {

    const poolData = {
        UserPoolId: userPoolId,
        ClientId: clientId 
    };

    const userPool = new cognito.CognitoUserPool(poolData);

    const authenticationData = {
        Username: username,
        Password: password,
    };

    const authenticationDetails = new cognito.AuthenticationDetails(authenticationData);

    const userData = {
        Username: username,
        Pool: userPool,
    };

    const cognitoUser = new cognito.CognitoUser(userData);

    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (res) => {
            const data = {
                refreshToken: res.getRefreshToken().getToken(),
                accessToken: res.getAccessToken().getJwtToken(),
                accessTokenExpiresAt: res.getAccessToken().getExpiration(),
                idToken: res.getIdToken().getJwtToken(),
                idTokenExpiresAt: res.getAccessToken().getExpiration(),
            };
            resolve(data)
        },
        onFailure: (err) => {
            reject(err);
        },
        newPasswordRequired: () => {
            console.log('New password required. Should not happen!!!')
            reject('NewPwdRequired');
        },
    });
};

const login = async (username, password, userPoolId, clientId) => {
    return await new Promise((resolve, reject) => {
        _internal_login(username, password, userPoolId, clientId, resolve, reject);
    });
};

const assumeTenantUserRole = async (accountId, identityPoolId, issuer, idToken) => {
    let response = await idClient.send(new cognitoidentity.GetIdCommand({
        IdentityPoolId: identityPoolId,
        AccountId: accountId,
        Logins: {
            [issuer]: idToken
        }
    }));

    const identityId = response.IdentityId;

    return await idClient.send(new cognitoidentity.GetCredentialsForIdentityCommand({
        IdentityId: identityId,
        Logins: {
            [issuer]: idToken
        }
    }));
};

const loginAndGetCredentials = async (accountId, region, username, password, identityPoolId, userPoolId, clientId) => {
    const loginResponse = await login(username, password, userPoolId, clientId);
    const issuer = `cognito-idp.${region}.amazonaws.com/${userPoolId}`
    const assumeRoleResponse = await assumeTenantUserRole(accountId, identityPoolId, issuer, loginResponse.idToken)

    return ({
        username: username,
        userPoolId: userPoolId,
        credentials: assumeRoleResponse.Credentials
    });
};

const createNewUserAndGetCredentials = async (accountId, region, tenantId, identityPoolId, userPoolId, clientId) => {
    const response = await createUserForTenant(tenantId, userPoolId);
    
    return await loginAndGetCredentials(accountId, region, response.username, response.password, identityPoolId, userPoolId, clientId);
};




exports.login = login;
exports.deleteUser = deleteUser;
exports.createNewUserAndGetCredentials = createNewUserAndGetCredentials;
exports.loginAndGetCredentials = loginAndGetCredentials;