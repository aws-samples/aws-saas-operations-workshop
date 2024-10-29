
const getTokenCall = async (url, data) => {
    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
    };
    return await fetch(url, requestOptions)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            return data.accessToken;
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

const getToken = async (requestParams, context, ee, next) => {
    const tokenData = {
        username: requestParams.vars.username,
        password: requestParams.vars.password
    }
    requestParams.vars.token = await getTokenCall(requestParams.vars.$processEnvironment.URL+'auth', tokenData)
};

export { getToken };