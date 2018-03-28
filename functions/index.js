let axios = require("axios");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const firebaseConfig = functions.config().firebase;
firebaseConfig.databaseAuthVariableOverride = {
	uid: "chain"
};
admin.initializeApp(firebaseConfig);
let firestore = admin.firestore();

var twilio = require("twilio");

const cors = require("cors")({ origin: true });

/**
 * slack
 * @param title = title of post to slack channel
 * @param subtitle = optional subtitle of post to slack channel
 * @param content = text of post to slack channel
 *
 * **/

const slack = (title, subtitle = null, content) => {
	// write slack post
	let text = "*" + title + "*" + " | " + content;

	if (subtitle != null) {
		text = "*" + title + "*" + " | " + subtitle + " | " + content;
	}
	// POST to slack webhook
	axios
		.post(functions.config().slack.url, { text: text })
		.then(response => {
			return response;
		})
		.catch(error => {
			return error;
		});
};

const notify = (type, recipient, otherPerson) => {
	return new Promise((resolve, reject) => {
		// the payload is what will be delivered to the device(s)
		let payload = {
			notification: {
				body: ""
			}
		};

		firestore
			.collection("people")
			.doc(recipient)
			.get()
			.then(person => {
				const pushToken = person.data().push_token;

				firestore
					.collection("people")
					.doc(otherPerson)
					.get()
					.then(doc => {
						payload.notification.title = "@" + doc.data().username;
						if (type == "request") {
							payload.notification.body = "sent you a request";
						} else if (type == "transaction") {
							payload.notification.body = "paid you";
						} else if (type == "accept") {
							payload.notification.body = "accepted your request";
						} else if (type == "decline") {
							payload.notification.body = "declined your request";
						} else if (type == "remind") {
							payload.notification.body = "sent you a reminder";
						} else if (type == "delete") {
							payload.notification.body =
								"deleted their request with you";
						}

						admin
							.messaging()
							.sendToDevice(pushToken, payload)
							.then(response => {
								resolve(response);
							})
							.catch(error => {
								reject(error);
							});
					})
					.catch(error => {
						reject(error);
					});
			})
			.catch(error => {
				reject(error);
			});
	});
};

const validSplashtag = splashtag => {
	// resolves true is splashtag is valid and unused
	return new Promise((resolve, reject) => {
		const now = Math.floor(new Date() / 1000);

		let output = {
			available: false,
			availableUser: false,
			availableWaitlist: false,
			validSplashtag: false
		};

		splashtag = splashtag.toLowerCase();
		if (/^[a-z0-9_-]{3,15}$/.test(splashtag)) {
			output.validSplashtag = true;

			firestore
				.collection("people")
				.where("username", "==", splashtag)
				.get()
				.then(people => {
					if (people.empty) {
						output.availableUser = true;

						firestore
							.collection("waitlist")
							.where("username", "==", splashtag)
							.get()
							.then(waitlist => {
								let anyClaimed = false;
								let anyPending = false;

								if (waitlist.empty) {
									output.available = true;
									output.availableWaitlist = true;
									resolve(output);
								} else {
									waitlist.forEach(doc => {
										const data = doc.data();
										if (data.claimed == true) {
											anyClaimed = true;
										} else if (
											data.timestamp_expires > now
										) {
											anyPending = true;
										}
									});

									if (anyPending || anyClaimed) {
										resolve(output);
									} else {
										output.available = true;
										output.availableWaitlist = true;
										resolve(output);
									}
								}
							})
							.catch(error => {
								reject(error);
							});
					} else {
						resolve(output);
					}
				})
				.catch(error => {
					reject(error);
				});
		} else {
			resolve(output);
		}
	});
};

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

exports.percentTaken = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		try {
			const startDate = new Date(2018, 2, 7, 0, 0);
			const now = new Date();

			const timeDiff = Math.abs(startDate.getTime() - now.getTime());
			const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) % 100;

			res.status(200).send(String(diffDays) + "." + now.getHours() % 10);
		} catch (error) {
			res.status(400).send(error);
		}
	});
});

exports.splashtagAvailable = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		const splashtag = req.query.splashtag.toLowerCase();
		validSplashtag(splashtag)
			.then(response => {
				res.status(200).send(response);
			})
			.catch(error => {
				res.status(400).send(error);
			});
	});
});

exports.claimSplashtag = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		const splashtag = req.query.splashtag;
		const phoneNumber = req.query.phone;

		var now = new Date();
		var fiveMinutes = new Date(now.getTime() + 5 * 60000);

		const client = new twilio(
			functions.config().twilio.sid,
			functions.config().twilio.token
		);

		const waitlist = {
			username: splashtag,
			claimed: false,
			phone_number: phoneNumber,
			timestamp_initiated: Math.floor(now / 1000),
			timestamp_expires: Math.floor(fiveMinutes / 1000)
		};

		validSplashtag(splashtag)
			.then(response => {
				if (response.available == true) {
					generateDynamicLink(splashtag, phoneNumber)
						.then(link => {
							const message =
								"Hi @" +
								splashtag +
								"! claim your splashtag within the next 5 minutes by following this link: " +
								link;

							client.messages
								.create({
									body: message,
									to: "+" + phoneNumber,
									from: "+12015834916"
								})
								.then(message => {
									firestore
										.collection("waitlist")
										.add(waitlist)
										.then(() => {
											res.status(200).send(message.sid);
										})
										.catch(error => {
											res.status(400).send(error);
										});
								})
								.catch(error => {
									res.status(400).send(error);
								});
						})
						.catch(error => {
							res.status(400).send(error);
						});
				} else {
					res.status(400).send("Error invalid splashtag");
				}
			})
			.catch(error => {
				res.status(400).send(error);
			});
	});
});