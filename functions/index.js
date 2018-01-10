let axios = require("axios")

const functions = require('firebase-functions')
const admin = require("firebase-admin")
const firebaseConfig = functions.config().firebase
firebaseConfig.databaseAuthVariableOverride = {
    uid: "chain"
}
admin.initializeApp(firebaseConfig);
let firestore = admin.firestore()

const CoinbaseClient = require('coinbase').Client;

const coinbase = new CoinbaseClient({
    'apiKey': functions.config().coinbase.key,
    'apiSecret': functions.config().coinbase.secret
});


/**
 * slack
 * @param title = title of post to slack channel
 * @param subtitle = optional subtitle of post to slack channel
 * @param content = text of post to slack channel
 *
 * **/
const slack = (title, subtitle=null, content) => {
    // write slack post
    let text = "**"+title+"**"+" | "+content

    if (subtitle != null) {
        text = "**"+title+"**"+" | "+subtitle+" | "+content
    }
    // POST to slack webhook
    axios.post(functions.config().slack.url, {text: text}).then(response => {
        return response
    }).catch(error => {
        return error
    })
}

// coinbase webhook
exports.coinbase = functions.https.onRequest((request, response) => {

    const timestampReceived = Math.floor(Date.now() / 1000)
    const notificationType = request.params.type

    // if new payment to address
    if (notificationType == "wallet:addresses:new-payment") {

        const address = request.params.data.address
        const amount = request.params.data.additional_data.amount.amount
        const currency = request.params.additional_data.amount.currency
        const tx = request.params.additional_data.hash
        const coinbaseTransactionId = request.params.additional_data.transaction.id
        const timestampCoinbaseCreated = Math.floor(Date.parse(request.params.created_at) / 1000)

        const addressRef = "crypto."+currency+".address"
        const balanceRef = "crypto."+currency+".balance"

        // find splash person associated with address
        firestore.collection("people").where(addressRef, "==", address).get().then(snapshot => {

            const person = snapshot[0]
            const email = person.data().email
            const defaultCurrency = person.data().default_currency

            // get exchange rate from coinbase
            coinbase.getExchangeRates({"currency": currency}, (error, rates) => {
                const exchangeRate = rates.data.rates.defaultCurrency

                // create transaction
                firestore.collection("transaction").add({
                    type: "coinbase",
                    to_id: person.id,
                    currency: currency,
                    amount: amount,
                    relative_currency: defaultCurrency,
                    relative_amount: exchangeRate*amount,
                    tx: tx,
                    fee: {
                        currency: "BTC",
                        amount: 0 // no fee when moving money in from coinbase
                    },
                    coinbase_transaction_id: coinbaseTransactionId,
                    timestamp_initiated: timestampCoinbaseCreated,
                    timestamp_completed: timestampReceived
                }).then(() => {
                    slack("chain:coinbase:createTransaction:success", email, amount)
                }).catch((error) => {
                    slack("chain:coinbase:createTransaction:failure", email, error.toString)
                })
            })

            // add inbound money to existing balance
            const oldBalance = person.data().crypto[currency].balance
            const newBalance = oldBalance + amount

            // update person's balance
            const updateObj = {}
            updateObj[balanceRef] = newBalance
            firestore.collection("people").doc(person.id).update(updateObj).then(() => {
                slack("chain:coinbase:updateBalance:success", email, oldBalance+" => "+newBalance)
            }).catch(error => {
                slack("chain:coinbase:updateBalance:failure", email, error.toString())
            })

        }).catch(error => {
            slack("chain:coinbase:queryAddress:failure", error.toString())
        })

    }

})

// function called on each new transaction pushed to chain
exports.hexaNewTransaction = functions.firestore.document("transactions/{transaction_id}").onCreate(event => {

    return new Promise((resolve, reject) => {

        try {

            const amount = event.data.data().amount
            const from_id = event.data.data().from_id
            const to_id = event.data.data().to_id
            const currency = event.data.data().currency

            // update balances
            firestore.collection("people").doc(from_id).get().then(person => {

                const balanceRef = "crypto." + currency + ".balance"

                const oldBalance = person.data().crypto[currency].balance

                const updateObj = {}
                updateObj[balanceRef] = oldBalance - amount
                if (oldBalance - amount < 0) {
                    slack("chain:newTransaction:updateBalance:positiveBalance:failure", error.toString)
                    reject("insufficient funds")
                }
                firestore.collection("people").doc(from_id).update(updateObj).catch(error => {
                    slack("chain:newTransaction:updateBalance:updateFromPerson:failure", error.toString)
                    reject(error)
                })
            }).catch(error => {
                slack("chain:newTransaction:updateBalance:getFromPerson:failure", error.toString)
                reject(error)
            })

            firestore.collection("people").doc(to_id).get().then(person => {

                const balanceRef = "crypto." + currency + ".balance"

                const oldBalance = person.data().crypto[currency].balance

                const updateObj = {}
                updateObj[balanceRef] = oldBalance + amount
                firestore.collection("people").doc(to_id).update(updateObj).catch(error => {
                    slack("chain:newTransaction:updateBalance:updateToPerson:failure", error.toString)
                    resolve("insufficient funds")
                })
            }).catch(error => {
                slack("chain:newTransaction:updateBalance:getToPerson:failure", error.toString)
                reject(error)
            })

            // TODO: send notification to sender

            // TODO: send notification to recipient

            // if transaction is out-of-network, initiate a transaction from coinbase
            if (event.data.data().type == "external") {

                const currency = event.data.data().currency
                const toAddress = event.data.data().to_address
                const amount = event.data.data().amount

                // get coinbase account for given crypto
                coinbase.getAccount(functions.config().coinbase[currency], (error, account) => {

                    // check error
                    if (error) {
                        slack("chain:newTransaction:external:coinbase:getAccount:failure", error.toString)
                        reject(error)
                    }

                    // TODO: check if account has enough money to send

                    // send money to external address
                    account.sendMoney({
                        to: toAddress,
                        amount: amount,
                        currency: currency,
                        idem: event.data.id
                    }, (error, tx) => {

                        // check error
                        if (error) {
                            slack("chain:newTransaction:external:coinbase:sendMoney:failure", error.toString)
                            reject(error)
                        }

                        // update transaction entity with tx
                        event.data.ref.update({
                            tx: tx
                        }).catch(error => {
                            slack("chain:newPerson:firestore:assignAddress:failure", error.toString)
                            reject(error)
                        })

                    })

                })
            }

            // resolve
            resolve("transaction approved and balances updated")
        }

        catch (err) {
            reject(err)
        }
    })

})

// function called each new person
exports.hexaNewPerson = functions.firestore.document("people/{personId}").onCreate(event => {

    return new Promise((resolve, reject) => {

        try {

            // create a new btc, bch, eth, ltc address for each person
            const cryptos = ["btc", "bch", "eth", "ltc"]

            // return object
            const returnObj = {}

            cryptos.forEach(crypto => {

                const coinbaseAccount = functions.config().coinbase[crypto]

                // get coinbase account for given crypto
                coinbase.getAccount(coinbaseAccount, (error, account) => {

                    if (error != null) {
                        slack("chain:newPerson:coinbase:getAccount:failure", error.toString)
                        reject(error)
                    }

                    const cryptoName = crypto.toUpperCase()

                    // generate new address
                    account.createAddress(null, (error, address) => {

                        const cryptoAddress = address.address

                        if (error != null) {
                            slack("chain:newPerson:coinbase:createAddress:failure", error.toString)
                            reject(error)
                        }

                        const cryptoRef = "crypto." + cryptoName

                        // add crypto address and initialized balance to firestore
                        const updateObj = {}
                        updateObj[cryptoRef] = {
                            "address": cryptoAddress
                        }
                        returnObj[cryptoRef] = updateObj[cryptoRef]
                        event.data.ref.update(updateObj).catch(error => {
                            slack("chain:newPerson:firestore:assignAddress:failure", error.toString)
                            reject(error)
                        })

                        // all is well
                        slack("chain:newPerson:firestore:assignAddress:failure", error.toString)
                        resolve("crypto addresses generated")

                    })

                })

            })
        }
        catch (err) {
            reject(err)
        }
    })

})

// TODO: GetPersonFromCrypto

// TODO: GetMerchantFromCrypto

// TODO: InitiateTransaction
