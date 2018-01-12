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
const coinbaseKey = functions.config().coinbase.key
const coinbaseSecret = functions.config().coinbase.secret


/**
 * slack
 * @param title = title of post to slack channel
 * @param subtitle = optional subtitle of post to slack channel
 * @param content = text of post to slack channel
 *
 * **/
const slack = (title, subtitle=null, content) => {
    // write slack post
    let text = "*"+title+"*"+" | "+content

    if (subtitle != null) {
        text = "*"+title+"*"+" | "+subtitle+" | "+content
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

    const coinbase = new CoinbaseClient({
        'apiKey': coinbaseKey,
        'apiSecret': coinbaseSecret
    })

    return new Promise((resolve, reject) => {

        try {

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

                const addressRef = "crypto." + currency + ".address"
                const balanceRef = "crypto." + currency + ".balance"

                // find splash person associated with address
                firestore.collection("people").where(addressRef, "==", address).get().then(snapshot => {

                    const person = snapshot[0].data()
                    const email = person.email
                    const defaultCurrency = person.default_currency

                    // get exchange rate from coinbase
                    const newTransaction = new Promise((resolve, reject) => {
                        coinbase.getExchangeRates({"currency": currency}, (error, rates) => {

                          if (error) {
                              reject(error)
                          }

                          const exchangeRate = rates.data.rates[defaultCurrency]

                          // create transaction
                          firestore.collection("transaction").add({
                              type: "coinbase",
                              to_id: snapshot[0].id,
                              currency: currency,
                              amount: amount,
                              relative_currency: defaultCurrency,
                              relative_amount: exchangeRate * amount,
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
                          }).catch(error => {
                              slack("chain:coinbase:createTransaction:failure", email, error.toString())
                              reject(error)
                          })
                      })
                  })

                  const updateBalance = new Promise((resolve, reject) => {
                      // add inbound money to existing balance
                      const oldBalance = person.crypto[currency].balance
                      const newBalance = oldBalance + amount

                      // update person's balance
                      const updateObj = {}
                      updateObj[balanceRef] = newBalance
                      firestore.collection("people").doc(snapshot[0].id).update(updateObj).then(() => {
                          slack("chain:coinbase:updateBalance:success", email, oldBalance + " => " + newBalance)
                      }).catch(error => {
                          slack("chain:coinbase:updateBalance:failure", email, error.toString())
                          reject(error)
                      })
                  })

                  Promise.all([newTransaction, updateBalance]).then(() => {
                    resolve("transaction approved and balances updated")
                  }).catch(error => {
                    reject(error)
                  })

                }).catch(error => {
                    slack("chain:coinbase:queryAddress:failure", error.toString())
                    reject(error)
                })

            }
        }
        catch (err) {
            reject(error)
        }

    })

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
            const updateBalanceFrom = new Promise((resolve, reject) => {
              firestore.collection("people").doc(from_id).get().then(person => {

                  const balanceRef = "crypto." + currency + ".balance"

                  const oldBalance = person.data().crypto[currency].balance

                  const updateObj = {}
                  updateObj[balanceRef] = oldBalance - amount
                  if (oldBalance - amount < 0) {
                      slack("Chain error", "chain:newTransaction:updateBalance:positiveBalance:failure")
                      reject("insufficient funds")
                  }
                  firestore.collection("people").doc(from_id).update(updateObj).then(response => {
                    resolve(response)
                  }).catch(error => {
                      slack("chain:newTransaction:updateBalance:updateFromPerson:failure", error.toString())
                      reject(error)
                  })
              }).catch(error => {
                  slack("Chain error", error.toString())
                  reject(error)
              })
            })

            const updateBalanceTo = new Promise((resolve, reject) => {
              firestore.collection("people").doc(to_id).get().then(person => {

                  const balanceRef = "crypto." + currency + ".balance"

                  const oldBalance = person.data().crypto[currency].balance

                  const updateObj = {}
                  updateObj[balanceRef] = oldBalance + amount
                  firestore.collection("people").doc(to_id).update(updateObj).then(response => {
                    resolve(response)
                  }).catch(error => {
                      slack("chain:newTransaction:updateBalance:updateToPerson:failure", error.toString())
                      reject("insufficient funds")
                  })
              }).catch(error => {
                  slack("chain:newTransaction:updateBalance:getToPerson:failure", error.toString())
                  reject(error)
              })
            })

            // TODO: send notification to sender

            // TODO: send notification to recipient

            const currency = event.data.data().currency
            const toAddress = event.data.data().to_address
            const amount = event.data.data().amount

            const coinbase = new CoinbaseClient({
                'apiKey': functions.config().coinbase.key,
                'apiSecret': functions.config().coinbase.secret
            });

            // get coinbase account for given crypto
            const getCoinbase = new Promise((resolve, reject) => {
              coinbase.getAccount(functions.config().coinbase[currency], (error, account) => {

                  // check error
                  if (error) {
                      slack("chain:newTransaction:external:coinbase:getAccount:failure", error.toString())
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
                          slack("chain:newTransaction:external:coinbase:sendMoney:failure", error.toString())
                          reject(error)
                      }

                      // update transaction entity with tx
                      event.data.ref.update({
                          tx: tx
                      }).then(response => {
                        resolve(response)
                      }).catch(error => {
                        slack("chain:newPerson:firestore:assignAddress:failure", error.toString())
                        reject(error)
                      })

                  })

              })
            })

            let promises = [updateBalanceFrom, updateBalanceTo]

            // if transaction is out-of-network, initiate a transaction from coinbase
            if (event.data.data().type == "external") {
              promises.push(getCoinbase)
            }

            // execute all promises
            Promise.all(promises).then(() => {
              resolve("transaction approved and balances updated")
            }).catch(error => {
              reject(error)
            })
        }

        catch (err) {
            reject(err)
        }
    })

})

// function called each new person
exports.hexaNewPerson = functions.firestore.document("people/{personId}").onCreate(event => {

    const coinbase = new CoinbaseClient({
        'apiKey': coinbaseKey,
        'apiSecret': coinbaseSecret
    })

    const createCrypto = (crypto) => {

      return new Promise((resolve, reject) => {

          try {

            const coinbaseAccount = functions.config().coinbase[crypto]

            // get coinbase account for given crypto
            coinbase.getAccount(coinbaseAccount, (error, account) => {

                const cryptoName = crypto.toUpperCase()

                console.log(coinbase, coinbaseAccount, account)

                if (error) {
                    console.log(error)
                    reject(error)
                }

                if (account) {
                    // generate new address
                    account.createAddress(null, (error, address) => {

                        if (error) {
                            slack("chain:newPerson:coinbase:createAddress:failure", error.toString())
                            reject(error)
                        }

                        const cryptoAddress = address.address

                        const cryptoRef = "crypto." + cryptoName

                        // add crypto address and initialized balance to firestore
                        const updateObj = {}
                        updateObj[cryptoRef] = {
                            "address": cryptoAddress,
                            "balance": 0
                        }
                        event.data.ref.update(updateObj).then(() => {
                          // all is well
                          slack("Chain", event.data.data().email, "initial crypto address generation")
                          resolve("crypto addresses generated")

                        }).catch(error => {
                            slack("Chain error", "chain:newPerson:firestore:assignAddress:failure", error.toString())
                            reject(error)
                        })

                    })
                }

            })
          }
          catch (error) {
              reject(error)
          }
      })
    }
    // create a new btc, bch, eth, ltc address for each person
    return new Promise ((resolve, reject) => {
      const cryptos = ["btc", "bch", "eth", "ltc"]
      let promises = []
      cryptos.forEach((crypto) => {
        promises.push(createCrypto(crypto))
      })
      Promise.all(promises).then(response => {
        resolve(response)
      }).catch(error => {
        reject(error)
      })
    })
})

// TODO: GetPersonFromCrypto

// TODO: GetMerchantFromCrypto

// TODO: InitiateTransaction
