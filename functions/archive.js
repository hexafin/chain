var SVB = require("svb-client")
const svbApiKey = functions.config().svb.api_key;
const svbHmacSecret = functions.config().svb.hmac_secret;


const generateDynamicLink = (splashtag, phoneNumber = "") => {
	// TODO: add app store link
	return new Promise((resolve, reject) => {
		const APIkey = functions.config().dynamiclink.key;

		const dynamicLink = {
			dynamicLinkInfo: {
				dynamicLinkDomain: "j9kf3.app.goo.gl",
				link:
					"https://splashwallet.io/" + splashtag + "/" + phoneNumber,
				iosInfo: {
					iosBundleId: functions.config().bundle.id
				},
				socialMetaTagInfo: {
					socialTitle: "Claim your Splashtag!",
					socialImageLink: "http://i63.tinypic.com/2h7qays.jpg"
				}
			},
			suffix: {
				option: "SHORT"
			}
		};

		axios
			.post(
				"https://firebasedynamiclinks.googleapis.com/v1/shortLinks?key=" +
					APIkey,
				dynamicLink
			)
			.then(response => {
				resolve(response.data.shortLink);
			})
			.catch(error => {
				reject(error);
			});
	});
};

const createVirtualCard = (type, amount, currency) => {
	return new Promise((resolve, reject) => {

		switch (currency) {

			// just for testing
			case "USD":
				const virtualCardData = {
					availableBalance: amount,
					cardNumber: "5563382306181964",
					currency: currency,
					cvc: "878",
					expiry: "2017-10",
					svbId: "87256",
					last4: "1964",
					totalCardAmount: amount,
					transactionsMax: 1,
					status: "Approved",
					testData: true
				}
				resolve(virtualCardData)

			// when we get svb api key, this should work
			case "USD_SVB":

				try {
					let client = new SVB({
						API_KEY: svbApiKey,
						HMAC_SECRET: svbHmacSecret,
						BASE_URL: "https://api.svb.com/"
					})
					let SVBCard = new SVBCards(client);
				}
				catch(error) {
					reject(error)
				}


				let validUntil
				let transactionsMax
				switch (type) {
					case "single-use":
						// get the date two days from today
						const twoDaysFromNow = new Date()
						twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
						var dd = twoDaysFromNow.getDate();
						var mm = twoDaysFromNow.getMonth() + 1;
						var y = twoDaysFromNow.getFullYear();
						validUntil = y + "-" + mm + "-" + dd

						transactionMax = 1

					default:
						reject("Card type not supported")
				}

				const showCardNumber = true
				SVBCard.create({
					"total_card_amount": amount,
					"valid_ending_on": validUntil
				}, showCardNumber, (err, response) => {

					if (err) {
						reject(err)
					}

					const virtualCardData = {
						availableBalance: response.data.available_balance,
						cardNumber: response.data.card_number,
						currency: response.data.currency,
						cvc: response.data.cvc,
						status: response.data.status,
						expiry: response.data.expiry,
						svbId: response.data.id,
						last4: response.data.last4,
						totalCardAmount: response.data.total_card_amount,
						transactionsMax: response.data.transactions_max
					}
					resolve(virtualCardData)
				})

			default:
				reject("Currency not supported: "+currency)

		}

	})
}

// WIP balance books function - to be connected to gdax
const balanceBooks = (direction, amount, currency) => {
	return new Promise((resolve, reject) => {

		switch (direction) {

			case "outbound":

				if (currency == "USD") {
					// sell bitcoin to recover USD

				}

			default:
				reject("Invalid direction")

		}

	})
}

/*
generate card endpoint
called by the mobile application after signing transaction and updating firebase doc
POST parameters {
	transactionId
}
creates a virtual card in accordance with the transaction and updates the firebase doc with card details
returns "Success" or error message with appropriate request statuses
*/
exports.generateCard = functions.https.onRequest((req, res) => {
	if (req.method == "POST") {
		try {

			let firestore = admin.firestore();

			const transactionId = req.body.transactionId

			firestore.collection("transactions").doc(transactionId).get().then(transactionDoc => {

				const transaction = transactionDoc.data()

				if (transaction.type == "card") {

					if (transaction.txId && !transaction.card) {

						// TODO: get details of transaction from tx_id => verify amounts and receiving address

						createVirtualCard("single-use", transaction.relativeAmount, transaction.relativeCurrency).then(card => {

							// balance books WIP
							// balanceBooks("outbound", card.totalCardAmount, card.currency)

							// add card to transactionn
							firestore.collection("transactions").doc(transactionId).update({
								card
							}).then(() => {
								res.status(200).send("Success")
							}).catch(error => {
								res.status(400).send(error)
							})
						}).catch(error => {
							res.status(400).send(error)
						})
					}
					else {
						res.status(400).send("Transaction not ready for card")
					}
				}
				else {
					res.status(400).send("Transaction type not supported")
				}


			}).catch(error => {
				res.status(400).send(error)
			})

		}
		catch (error) {
			res.status(400).send(error)
		}
	}
});

exports.createDynamicLink = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		const splashtag = req.query.splashtag;
		generateDynamicLink(splashtag)
			.then(link => {
				res.status(200).send(link);
			})
			.catch(error => {
				res.status(400).send(error);
			});
	});
});