const VINE_HELPER_API_V5_URL = "https://api.vinehelper.ovh";

//Notification arrive one at the time
//These variable allow to remember the type of notifications received
//so that when the batch end, if notification(s) were received
//the proper sound effect can be played.
var notification_added_item = false;
var notification_highlight = false;
var notification_zeroETV = false;

//const TYPE_SHOW_ALL = -1;
const TYPE_REGULAR = 0;
const TYPE_ZEROETV = 1;
const TYPE_HIGHLIGHT = 2;
//const TYPE_HIGHLIGHT_OR_ZEROETV = 9;

if (typeof browser === "undefined") {
	var browser = chrome;
}

//Required for the Template engine but not of any use in this script.
var arrDebug = [];
const items = new Map();
const imageUrls = new Set();

var startTime = Date.now();
function showRuntime(eventName) {
	arrDebug.push({ time: Date.now() - startTime, event: eventName });
}
function showDebug() {
	console.log(JSON.stringify(arrDebug));
}

var Settings = new SettingsMgr();
var Tpl = new Template();
var TplMgr = new TemplateMgr();
var loadedTpl = null;

const vineLocales = {
	ca: { locale: "en-CA", currency: "CAD" },
	com: { locale: "en-US", currency: "USD" },
	uk: { locale: "en-GB", currency: "GBP" },
	jp: { locale: "ja-JP", currency: "JPY" },
	de: { locale: "de-DE", currency: "EUR" },
	fr: { locale: "fr-FR", currency: "EUR" },
	es: { locale: "es-ES", currency: "EUR" },
	it: { locale: "it-IT", currency: "EUR" },
};
const vineDomains = {
	ca: "ca",
	com: "com",
	uk: "co.uk",
	jp: "co.jp",
	de: "de",
	fr: "fr",
	es: "es",
	it: "it",
};

var vineLocale = null;
var vineCurrency = null;
var vineDomain = null;
var Notifications = new ScreenNotifier();
const broadcastChannel = new BroadcastChannel("VineHelperChannel");

const handleReportClick = (e) => {
	e.preventDefault(); // Prevent the default click behavior
	report(e.target.dataset.asin);
};

const handleBrendaClick = (e) => {
	e.preventDefault();

	const asin = e.target.dataset.asin;
	const queue = e.target.dataset.queue;
	const etv = document.querySelector("#vh-notification-" + asin + " .etv_value").innerText;
	window.BrendaAnnounceQueue.announce(asin, etv, queue);
};

window.onload = function () {
	broadcastChannel.onmessage = async function (event) {
		let data = event.data;
		if (data.type == undefined) return;

		if (data.type == "newItem") {
			addItem(data);
		}
		if (data.type == "newItemCheck") {
			muteSound = false;
			//Display a notification that we have checked for items.
			let note = new ScreenNotification();
			note.template = "view/notification_loading.html";
			note.lifespan = 3;
			Notifications.pushNotification(note);
		}
		if (data.type == "newItemCheckEnd") {
			if (notification_added_item) {
				playSoundAccordingToNotificationType(notification_highlight, notification_zeroETV);
			}
			notification_added_item = false;
			notification_highlight = false;
			notification_zeroETV = false;
		}
		/*
		if (data.type == "wsOpen") {
			document.getElementById("statusWS").innerHTML =
				"<strong>Server status: </strong><div class='vh-switch-32 vh-icon-switch-on'></div> Listening for notifications...";
		}
		if (data.type == "wsClosed") {
			document.getElementById("statusWS").innerHTML =
				"<strong>Server status: </strong><div class='vh-switch-32 vh-icon-switch-off'></div> Not connected. Retrying in 30 sec.";
		}
		*/
	};

	//Clear the debug log every 30 minutes to save memory usage.
	setInterval(
		async () => {
			arrDebug = [];
		},
		30 * 60 * 1000
	);

	init();
};

async function init() {
	//Wait for the settings to be loaded.
	while (!Settings.isLoaded()) {
		await new Promise((r) => setTimeout(r, 10));
	}
	vineCountry = Settings.get("general.country");
	setLocale(vineCountry);
	loadedTpl = await Tpl.loadFile("/view/notification_monitor.html");

	if (!Settings.get("notification.active")) {
		document.getElementById("status").innerHTML =
			"<strong>Notifications disabled</strong> You need to enable the notifications for this window to work.";
	}

	//Bind the event when changing the filter
	const filter = document.querySelector("select[name='filter-type']");
	filter.addEventListener("change", function () {
		if (filter.value == "-1") {
			//Display all notifications
			document.querySelectorAll(".vh-notification-box").forEach(function (node, key, parent) {
				node.style.display = "grid";
			});
		} else {
			//Display a specific type of notifications only
			document.querySelectorAll(".vh-notification-box").forEach(function (node, key, parent) {
				processNotificationFiltering(node);
			});
		}
	});

	//Bind fetch-last-100 button
	/*
	const btnLast100 = document.querySelector("button[name='fetch-last-100']");
	btnLast100.addEventListener("click", function () {
		browser.runtime.sendMessage(
			{
				type: "fetchLast100Items",
			},
			function (response) {
				if (browser.runtime.lastError) {
					console.error("Error sending message:", browser.runtime.lastError.message);
				}
			}
		);
	});
	*/

	//Obtain the status of the WebSocket connection.
	browser.runtime.sendMessage({
		type: "wsStatus",
	});
}

//Function to determine if the notification has to be displayed base on the filtering option.
function processNotificationFiltering(node) {
	const filter = document.querySelector("select[name='filter-type']");
	const notificationType = parseInt(node.getAttribute("data-notification-type"));

	if (filter.value == -1) {
		node.style.display = "grid";
	} else if (filter.value == 9) {
		const typesToShow = [TYPE_HIGHLIGHT, TYPE_ZEROETV];
		node.style.display = typesToShow.includes(notificationType) ? "grid" : "none";
	} else {
		node.style.display = notificationType == filter.value ? "grid" : "none";
	}
}

//Set the locale and currency based on the domain.
//As this is an internal page from the extension, we can only know what
//country/domain is being used when we first receive data.
async function setLocale(country) {
	if (Object.prototype.hasOwnProperty.call(vineLocales, country)) {
		vineLocale = vineLocales[country].locale;
		vineCurrency = vineLocales[country].currency;
		vineDomain = vineDomains[country];

		if (Settings.get("notification.active")) {
			document.getElementById("status").innerHTML =
				"<strong>Notification Monitor: </strong><div class='vh-switch-32 vh-icon-switch-on'></div>";
		}

		document.getElementById("date_loaded").innerText = new Date().toLocaleString(vineLocale);
	}
}

function addItem(data) {
	let {
		date,
		asin,
		title,
		search,
		img_url,
		domain,
		etv,
		queue,
		KWsMatch,
		hideMatch,
		is_parent_asin,
		enrollment_guid,
	} = data;

	let type = TYPE_REGULAR;

	//If the locale is not define, set it.
	if (vineLocale == null) setLocale(domain);

	if (etv == "0.00") {
		type = TYPE_ZEROETV;
		notification_zeroETV = true;
	}

	if (Settings.get("notification.monitor.hideDuplicateThumbnail") && imageUrls.has(img_url)) {
		showRuntime("NOTIFICATION: item " + asin + " has a duplicate image and won't be shown.");
		return;
	}

	//Highlight the item
	if (KWsMatch) {
		showRuntime("NOTIFICATION: item " + asin + " match the highlight list and will be highlighed.");
		type = TYPE_HIGHLIGHT;
		notification_highlight = true;

		//Hide the item
	} else if (Settings.get("notification.monitor.hideList") && hideMatch) {
		showRuntime("NOTIFICATION: item " + asin + " match the hidden list and won't be shown.");
		return;
	}

	if (items.has(asin)) {
		//Item already exist, update ETV
		if (etv != items.get(asin)) {
			setETV(asin, etv);
		}
	} else {
		notification_added_item = true;

		//New item to be added
		items.set(asin, etv);
		imageUrls.add(img_url);

		if (Settings.get("general.searchOpenModal") && is_parent_asin != null && enrollment_guid != null) {
			Tpl.setVar(
				"url",
				`https://www.amazon.${vineDomain}/vine/vine-items?queue=encore#openModal;${asin};${queue};${is_parent_asin};${enrollment_guid}`
			);
		} else {
			Tpl.setVar("url", `https://www.amazon.${vineDomain}/vine/vine-items?search=${search}`);
		}

		Tpl.setVar("asin", asin);
		Tpl.setVar("is_parent_asin", is_parent_asin);
		Tpl.setVar("enrollment_guid", enrollment_guid);
		Tpl.setVar("domain", vineDomain);
		Tpl.setVar("title", "New item");
		Tpl.setVar("date", formatDate(date));
		Tpl.setVar("search", search);
		Tpl.setVar("description", title);
		Tpl.setVar("img_url", img_url);
		Tpl.setVar("queue", queue);
		Tpl.setVar("type", type);
		Tpl.setVar("etv", formatETV(etv));
		Tpl.setIf("announce", Settings.get("discord.active") && Settings.get("discord.guid", false) != null);
		let content = Tpl.render(loadedTpl, true); //true to return a DOM object instead of an HTML string

		const newBody = document.getElementById("vh-items-container");
		newBody.prepend(content);

		//Apply the filter.
		processNotificationFiltering(content);

		//Set ETV
		setETV(asin, etv);

		//Highlight background color
		if (KWsMatch) {
			const obj = elementByAsin(asin);
			obj.style.backgroundColor = Settings.get("notification.monitor.highlight.color");
		}

		// Add new click listener for the report button
		document
			.querySelector("#vh-notification-" + asin + " .report-link")
			.addEventListener("click", handleReportClick);

		//Add new click listener for Brenda announce:
		document
			.querySelector("#vh-notification-" + asin + " .vh-announce-link")
			.addEventListener("click", handleBrendaClick);

		//Update the most recent date
		document.getElementById("date_most_recent_item").innerText = formatDate(date);

		//Auto truncate
		if (document.getElementById("auto-truncate").checked) {
			const itemsD = document.getElementsByClassName("vh-notification-box");
			const itemsCount = itemsD.length;
			if (itemsCount > 2000) {
				for (let i = itemsCount - 1; i >= 2000; i--) {
					const asin = itemsD[i].dataset.asin;
					items.delete(asin);
					itemsD[i].remove(); //remove the element from the DOM
				}
			}
		}
	}
}

//Prepare the ETV to be displayed
function formatETV(etv) {
	let formattedETV = "";
	if (etv != null) {
		formattedETV = new Intl.NumberFormat(vineLocale, {
			style: "currency",
			currency: vineCurrency,
		}).format(etv);
	}
	return formattedETV;
}

function formatDate(date) {
	return new Date(date + " GMT").toLocaleString(vineLocale);
}

function playSoundAccordingToNotificationType(highlightMatch = false, zeroETV = false) {
	let volume, filename;

	//Highlight notification
	volume = Settings.get("notification.monitor.highlight.volume");
	filename = Settings.get("notification.monitor.highlight.sound");
	if (highlightMatch && filename != "0" && volume > 0) {
		playSound(filename, volume);
		return true;
	}

	//Zero ETV notification
	volume = Settings.get("notification.monitor.zeroETV.volume");
	filename = Settings.get("notification.monitor.zeroETV.sound");
	if (zeroETV && filename != "0" && volume > 0) {
		playSound(filename, volume);
		return true;
	}

	//Regular notification
	volume = Settings.get("notification.monitor.regular.volume");
	filename = Settings.get("notification.monitor.regular.sound");
	if (filename != "0" && volume > 0) {
		playSound(filename, volume);
		return true;
	}

	return false;
}

function playSound(filename, volume) {
	const audioElement = new Audio(browser.runtime.getURL("resource/sound/" + filename + ".mp3"));
	const handleEnded = () => {
		audioElement.removeEventListener("ended", handleEnded); // Remove the event listener
		audioElement.remove(); // Remove the audio element from the DOM
	};
	audioElement.addEventListener("ended", handleEnded);
	if (volume >= 0 && volume <= 1) {
		audioElement.volume = Number(volume);
	}
	audioElement.play();
}

function itemID(asin) {
	return `vh-notification-${asin}`;
}

function elementByAsin(asin) {
	return document.getElementById(itemID(asin));
}

function setETV(asin, etv) {
	const obj = elementByAsin(asin);

	//Highlight for ETV
	if (etv == "0.00") {
		obj.style.backgroundColor = Settings.get("notification.monitor.zeroETV.color");
		if (obj.getAttribute("data-notification-type") != TYPE_HIGHLIGHT) {
			obj.setAttribute("data-notification-type", TYPE_ZEROETV);
		}
	}
	//Remove ETV Value if it does not exist
	let etvElement = document.querySelector("#" + itemID(asin) + " .etv_value");
	let brendaAnnounce = document.querySelector("#vh-announce-link-" + asin);
	if (etv == null) {
		etvElement.style.display = "none";

		if (brendaAnnounce) {
			brendaAnnounce.style.visibility = "hidden";
		}
	} else {
		etvElement.innerText = etv;

		if (brendaAnnounce) {
			brendaAnnounce.style.visibility = "visible";
		}
	}
}

function report(asin) {
	let val = prompt(
		"Are you sure you want to REPORT the user who posted ASIN#" +
			asin +
			"?\n" +
			"Only report notifications which are not Amazon products\n" +
			"Note: False reporting may get you banned.\n\n" +
			"type REPORT in the field below to send a report:"
	);
	if (val !== null && val.toLowerCase() == "report") {
		send_report(asin);
	}
	return false;
}

function send_report(asin) {
	let manifest = chrome.runtime.getManifest();

	const content = {
		api_version: 5,
		app_version: manifest.version,
		country: vineDomain,
		action: "report_asin",
		uuid: Settings.get("general.uuid", false),
		asin: asin,
	};
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(content),
	};

	showRuntime("Sending report...");

	//Send the report to VH's server
	fetch(VINE_HELPER_API_V5_URL, options)
		.then(report_sent)
		.catch(function () {
			showRuntime(error);
		});
}

function report_sent() {
	alert("Report sent. Thank you.");
}
