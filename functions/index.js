const functions = require('firebase-functions');

// TODO: AuthPerson
exports.AuthPerson = functions.https.onRequest((request, response) => {
    response.send("Hello from Firebase!");
})


// TODO: GetPersonFromCrypto

// TODO: GetMerchantFromCrypto

// TODO: InitiateTransaction