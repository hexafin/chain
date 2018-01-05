const functions = require('firebase-functions')
const admin = require("firebase-admin")
let firestore = admin.firestore()
let axios = require("axios")

const coinbaseClient = require('coinbase').Client;

const coinbase = new coinbaseClient({
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
    if (subtitle == null) {
        const text = "**"+title+"**"+" | "+content
    }
    else {
        const text = "**"+title+"**"+" | "+subtitle+" | "+content
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
exports.hexaNewTransaction = functions.firestore.document("transactions/{transaction_id}").onWrite(event => {

    const amount = event.data.data().amount
    const from_id = event.data.data().from_id
    const to_id = event.data.data().to_id
    const currency = event.data.data().currency

    // update balances
    firestore.collection("people").doc(from_id).get().then(person => {

        const balanceRef = "crypto."+currency

        const oldBalance = person.data().crypto[currency].balance

        const updateObj = {}
        updateObj[balanceRef] = oldBalance - amount
        if (oldBalance - amount < 0) {
            slack("chain:newTransaction:updateBalance:positiveBalance:failure", error.toString)
            return
        }
        firestore.collection("people").doc(from_id).update(updateObj)
    }).catch(error => {
        slack("chain:newTransaction:updateBalance:getFromPerson:failure", error.toString)
    })

    firestore.collection("people").doc(to_id).get().then(person => {

        const balanceRef = "crypto."+currency

        const oldBalance = person.data().crypto[currency].balance

        const updateObj = {}
        updateObj[balanceRef] = oldBalance + amount
        firestore.collection("people").doc(to_id).update(updateObj)
    }).catch(error => {
        slack("chain:newTransaction:updateBalance:getToPerson:failure", error.toString)
    })

    // TODO: send notification to sender

    // TODO: send notification to recipient

    // TODO: if transaction is out-of-network, initiate a transaction from coinbase

})

// function called each new person
exports.hexaNewPerson = functions.firestore.document("people/{personId}").onWrite(event => {

    // create a new btc, bch, eth, ltc address for each person
    const cryptos = ["BTC", "BCH", "ETH", "LTC"]

    cryptos.forEach((crypto) => {

        // get coinbase account for given crypto
        coinbase.getAccount(functions.config().coinbase[crypto], (error, account) => {

            // generate new address
            account.createAddress(null, (error, address) => {

                const cryptoRef = "crypto."+crypto

                // add crypto address and initialized balance to firestore
                const updateObj = {}
                updateObj[cryptoRef] = {
                    "address": address,
                    "balance": 0
                }
                firestore.collection("people").doc(event.params.personId).update(updateObj)

            })

        })

    })

})

// TODO: GetPersonFromCrypto

// TODO: GetMerchantFromCrypto

// TODO: InitiateTransaction