/*
* jQuery Mobile Framework : core utilities for auto ajax navigation, base tag mgmt,
* Copyright (c) jQuery Project
* Dual licensed under the MIT or GPL Version 2 licenses.
* http://jquery.org/license
*/
(function($, undefined ) {

	//define vars for interal use
	var $window = $(window),
		$html = $('html'),
		$head = $('head'),

		//url path helpers for use in relative url management
		path = {

			//get path from current hash, or from a file path
			get: function( newPath ){
				if( newPath == undefined ){
					newPath = location.hash;
				}
				return path.stripHash( newPath ).replace(/[^\/]*\.[^\/*]+$/, '');
			},

			//return the substring of a filepath before the sub-page key, for making a server request
			getFilePath: function( path ){
				var splitkey = '&' + $.mobile.subPageUrlKey;
				return path && path.indexOf( splitkey ) > -1 ? path.split( splitkey )[0] : path;
			},
			
			//set location hash to path, optionally disable hash listening
			set: function( path, disableListening){
				if( disableListening ) { 
					hashListener = false;
				}
				location.hash = path;
			},

			//location pathname from intial directory request
			origin: '',

			setOrigin: function(){
				path.origin = path.get( location.protocol + '//' + location.host + location.pathname );
			},
			
			//prefix a relative url with the current path
			makeAbsolute: function( url ){
				return path.get() + url;
			},
			
			//return a url path with the window's location protocol/hostname removed
			clean: function( url ){
				return url.replace( location.protocol + "//" + location.host, "");
			},
			
			//just return the url without an initial #
			stripHash: function( url ){
				return url.replace( /^#/, "" );
			},
			
			//check whether a url is referencing the same domain, or an external domain or different protocol
			//could be mailto, etc
			isExternal: function( url ){
				return path.hasProtocol( path.clean( url ) );
			},
			
			hasProtocol: function( url ){
				return /^(:?\w+:)/.test( url );
			},
			
			//check if the url is relative
			isRelative: function( url ){
				return  /^[^\/|#]/.test( url ) && !path.hasProtocol( url );
			}
		},

		//will be defined when a link is clicked and given an active class
		$activeClickedLink = null,

		//array of pages that are visited during a single page load
		//length will grow as pages are visited, and shrink as "back" link/button is clicked
		//each item has a url (string matches ID), and transition (saved for reuse when "back" link/button is clicked)
		urlStack = [ {
			url: location.hash.replace( /^#/, "" ),
			transition: undefined
		} ],

		//define first selector to receive focus when a page is shown
		focusable = "[tabindex],a,button:visible,select:visible,input",

		//contains role for next page, if defined on clicked link via data-rel
		nextPageRole = null,

		//enable/disable hashchange event listener
		//toggled internally when location.hash is updated to match the url of a successful page load
		hashListener = true;

		//existing base tag?
		var $base = $head.children("base"),
			hostURL = location.protocol + '//' + location.host,
			docLocation = path.get( hostURL + location.pathname ),
			docBase = docLocation;

		if ($base.length){
			var href = $base.attr("href");
			if (href){
				if (href.search(/^[^:/]+:\/\/[^/]+\/?/) == -1){
					//the href is not absolute, we need to turn it into one
					//so that we can turn paths stored in our location hash into
					//relative paths.
					if (href.charAt(0) == '/'){
						//site relative url
						docBase = hostURL + href;
					}
					else {
						//the href is a document relative url
						docBase = docLocation + href;
						//XXX: we need some code here to calculate the final path
						//     just in case the docBase contains up-level (../) references.
					}
				}
				else {
					//the href is an absolute url
					docBase = href;
				}
			}
			//make sure docBase ends with a slash
			docBase = docBase  + (docBase.charAt(docBase.length - 1) == '/' ? ' ' : '/');
		}

		//base element management, defined depending on dynamic base tag support
		base = $.support.dynamicBaseTag ? {

			//define base element, for use in routing asset urls that are referenced in Ajax-requested markup
			element: ($base.length ? $base : $("<base>", { href: docBase }).prependTo( $head )),

			//set the generated BASE element's href attribute to a new page's base path
			set: function( href ){
				base.element.attr('href', docBase + path.get( href ));
			},

			//set the generated BASE element's href attribute to a new page's base path
			reset: function(){
				base.element.attr('href', docBase );
			}

		} : undefined;



		//set location pathname from intial directory request
		path.setOrigin();

/*
	internal utility functions
--------------------------------------*/


	//direct focus to the page title, or otherwise first focusable element
	function reFocus( page ){
		var pageTitle = page.find( ".ui-title:eq(0)" );
		if( pageTitle.length ){
			pageTitle.focus();
		}
		else{
			page.find( focusable ).eq(0).focus();
		}
	};

	//remove active classes after page transition or error
	function removeActiveLinkClass( forceRemoval ){
		if( !!$activeClickedLink && (!$activeClickedLink.closest( '.ui-page-active' ).length || forceRemoval )){
			$activeClickedLink.removeClass( $.mobile.activeBtnClass );
		}
		$activeClickedLink = null;
	};

	//animation complete callback
	$.fn.animationComplete = function( callback ){
		if($.support.cssTransitions){
			return $(this).one('webkitAnimationEnd', callback);
		}
		else{
			callback();
		}
	};



/* exposed $.mobile methods	 */

	//update location.hash, with or without triggering hashchange event
	//TODO - deprecate this one
	$.mobile.updateHash = path.set;
	
	//expose path object on $.mobile
	$.mobile.path = path;
	
	//expose base object on $.mobile
	$.mobile.base = base;

	//url stack, useful when plugins need to be aware of previous pages viewed
	$.mobile.urlStack = urlStack;


	// changepage function
	$.mobile.changePage = function( to, transition, back, changeHash){

		//from is always the currently viewed page
		var toIsArray = $.type(to) === "array",
			from = toIsArray ? to[0] : $.mobile.activePage,
			to = toIsArray ? to[1] : to,
			url = fileUrl = $.type(to) === "string" ? to.replace( /^#/, "" ) : null,
			data = undefined,
			type = 'get',
			isFormRequest = false,
			duplicateCachedPage = null,
			back = (back !== undefined) ? back : ( urlStack.length > 1 && urlStack[ urlStack.length - 2 ].url === url );

		//If we are trying to transition to the same page that we are currently on ignore the request.
		if(urlStack.length > 1 && url === urlStack[urlStack.length -1].url && !toIsArray ) {
			return;
		}

		if( $.type(to) === "object" && to.url ){
			url = to.url,
			data = to.data,
			type = to.type,
			isFormRequest = true;
			//make get requests bookmarkable
			if( data && type == 'get' ){
				url += "?" + data;
				data = undefined;
			}
		}

		//reset base to pathname for new request
		if(base){ base.reset(); }

		//kill the keyboard
		$( window.document.activeElement ).add(':focus').blur();

		function defaultTransition(){
			if(transition === undefined){
				transition = $.mobile.defaultTransition;
			}
		}

		// if the new href is the same as the previous one
		if ( back ) {
			var pop = urlStack.pop();

			// prefer the explicitly set transition
			if( pop && !transition ){
				transition = pop.transition;
			}

			// ensure a transition has been set where pop is undefined
			defaultTransition();
		} else {
			// If no transition has been passed
			defaultTransition();

			// push the url and transition onto the stack
			urlStack.push({ url: url, transition: transition });
		}

		//function for transitioning between two existing pages
		function transitionPages() {

			//get current scroll distance
			var currScroll = $window.scrollTop(),
					perspectiveTransitions = ["flip"],
					pageContainerClasses = [];

			//set as data for returning to that spot
			from.data('lastScroll', currScroll);

			//trigger before show/hide events
			from.data("page")._trigger("beforehide", {nextPage: to});
			to.data("page")._trigger("beforeshow", {prevPage: from});

			function loadComplete(){
				$.mobile.pageLoading( true );

				reFocus( to );

				if( changeHash !== false && url ){
					path.set(url, (back !== true));
				}
				removeActiveLinkClass();

				//jump to top or prev scroll, if set
				$.mobile.silentScroll( to.data( 'lastScroll' ) );

				//trigger show/hide events, allow preventing focus change through return false
				from.data("page")._trigger("hide", null, {nextPage: to});
				if( to.data("page")._trigger("show", null, {prevPage: from}) !== false ){
					$.mobile.activePage = to;
				}

				//if there's a duplicateCachedPage, remove it from the DOM now that it's hidden
				if (duplicateCachedPage != null) {
				    duplicateCachedPage.remove();
				}
			};

			function addContainerClass(className){
				$.mobile.pageContainer.addClass(className);
				pageContainerClasses.push(className);
			};

			function removeContainerClasses(){
				$.mobile
					.pageContainer
					.removeClass(pageContainerClasses.join(" "));

				pageContainerClasses = [];
			};

			if(transition && (transition !== 'none')){
				if( $.inArray(transition, perspectiveTransitions) >= 0 ){
					addContainerClass('ui-mobile-viewport-perspective');
				}

				addContainerClass('ui-mobile-viewport-transitioning');

				// animate in / out
				from.addClass( transition + " out " + ( back ? "reverse" : "" ) );
				to.addClass( $.mobile.activePageClass + " " + transition +
					" in " + ( back ? "reverse" : "" ) );

				// callback - remove classes, etc
				to.animationComplete(function() {
					from.add( to ).removeClass("out in reverse " + transition );
					from.removeClass( $.mobile.activePageClass );
					loadComplete();
					removeContainerClasses();
				});
			}
			else{
				from.removeClass( $.mobile.activePageClass );
				to.addClass( $.mobile.activePageClass );
				loadComplete();
			}
		};

		//shared page enhancements
		function enhancePage(){

			//set next page role, if defined
			if ( nextPageRole || to.data('role') == 'dialog' ) {
				changeHash = false;
				if(nextPageRole){
					to.attr( "data-role", nextPageRole );
					nextPageRole = null;
				}
			}

			//run page plugin
			to.page();
		};

		//if url is a string
		if( url ){
			to = $( "[data-url='" + url + "']" );
			fileUrl = path.getFilePath(url);
		}
		else{ //find base url of element, if avail
			var toID = to.attr('data-url'),
				toIDfileurl = path.getFilePath(toID);

			if(toID != toIDfileurl){
				fileUrl = toIDfileurl;
			}
		}

		// find the "to" page, either locally existing in the dom or by creating it through ajax
		if ( to.length && !isFormRequest ) {
			if( fileUrl && base ){
				base.set( fileUrl );
			}
			enhancePage();
			transitionPages();
		} else {

			//if to exists in DOM, save a reference to it in duplicateCachedPage for removal after page change
			if( to.length ){
				duplicateCachedPage = to;
			}

			$.mobile.pageLoading();

			$.ajax({
				url: fileUrl,
				type: type,
				data: data,
				success: function( html ) {
					if(base){ base.set(fileUrl); }

					var all = $("<div></div>");
					//workaround to allow scripts to execute when included in page divs
					all.get(0).innerHTML = html;
					to = all.find('[data-role="page"], [data-role="dialog"]').first();

					//rewrite src and href attrs to use a base url
					if( !$.support.dynamicBaseTag ){
						var newPath = path.get( fileUrl );
						to.find('[src],link[href]').each(function(){
							var thisAttr = $(this).is('[href]') ? 'href' : 'src',
								thisUrl = $(this).attr(thisAttr);

							//if full path exists and is same, chop it - helps IE out
							thisUrl.replace( location.protocol + '//' + location.host + location.pathname, '' );

							if( !/^(\w+:|#|\/)/.test(thisUrl) ){
								$(this).attr(thisAttr, newPath + thisUrl);
							}
						});
					}

					to
						.attr( "data-url", fileUrl )
						.appendTo( $.mobile.pageContainer );

					enhancePage();
					transitionPages();
				},
				error: function() {
					$.mobile.pageLoading( true );
					removeActiveLinkClass(true);
					base.set(path.get());
					$("<div class='ui-loader ui-overlay-shadow ui-body-e ui-corner-all'><h1>Error Loading Page</h1></div>")
						.css({ "display": "block", "opacity": 0.96, "top": $(window).scrollTop() + 100 })
						.appendTo( $.mobile.pageContainer )
						.delay( 800 )
						.fadeOut( 400, function(){
							$(this).remove();
						});
				}
			});
		}

	};


/* Event Bindings - hashchange, submit, and click */

	//bind to form submit events, handle with Ajax
	$( "form[data-ajax!='false']" ).live('submit', function(event){
		if( !$.mobile.ajaxFormsEnabled ){ return; }

		var type = $(this).attr("method"),
			url = path.clean( $(this).attr( "action" ) );

		//external submits use regular HTTP
		if( path.isExternal( url ) ){
			return;
		}

		//if it's a relative href, prefix href with base url
		if( path.isRelative( url ) ){
			url = path.makeAbsolute( url );
		}

		$.mobile.changePage({
				url: url,
				type: type,
				data: $(this).serialize()
			},
			undefined,
			undefined,
			true
		);
		event.preventDefault();
	});


	//click routing - direct to HTTP or Ajax, accordingly
	$( "a" ).live( "click", function(event) {
		
		var $this = $(this),
			//get href, remove same-domain protocol and host
			url = path.clean( $this.attr( "href" ) ),
			
			//check if it's external
			isExternal = path.isExternal( url ) || $this.is( "[rel='external']" ),
			
			//if target attr is specified we mimic _blank... for now
			hasTarget = $this.is( "[target]" );
			

		if( url === "#" ){
			//for links created purely for interaction - ignore
			return false;
		}

		$activeClickedLink = $this.closest( ".ui-btn" ).addClass( $.mobile.activeBtnClass );

		if( isExternal || hasTarget || !$.mobile.ajaxLinksEnabled ){
			//remove active link class if external (then it won't be there if you come back)
			removeActiveLinkClass(true);

			//deliberately redirect, in case click was triggered
			if( hasTarget ){
				window.open( url );
			}
			else{
				location.href = url;
			}
		}
		else {
			//use ajax
			var transition = $this.data( "transition" ),
				back = $this.data( "back" );

			nextPageRole = $this.attr( "data-rel" );

			//if it's a relative href, prefix href with base url
			if( path.isRelative( url ) ){
				url = path.makeAbsolute( url );
			}

			url = path.stripHash( url );

			$.mobile.changePage( url, transition, back);
		}
		event.preventDefault();
	});



	//hashchange event handler
	$window.bind( "hashchange", function(e, triggered) {
		if( !hashListener ){
			hashListener = true;
			return;
		}

		if( $(".ui-page-active").is("[data-role=" + $.mobile.nonHistorySelectors + "]") ){
			return;
		}

		var to = location.hash,
			transition = triggered ? false : undefined;

		//if to is defined, use it
		if ( to ){
			$.mobile.changePage( to, transition, undefined, false);
		}
		//there's no hash, the active page is not the start page, and it's not manually triggered hashchange
		//we probably backed out to the first page visited
		else if( $.mobile.activePage.length && $.mobile.startPage[0] !== $.mobile.activePage[0] && !triggered ) {
			$.mobile.changePage( $.mobile.startPage, transition, true, false );
		}
		//probably the first page - show it
		else{
			$.mobile.startPage.trigger("pagebeforeshow", {prevPage: $('')});
			$.mobile.startPage.addClass( $.mobile.activePageClass );
			$.mobile.pageLoading( true );

			if( $.mobile.startPage.trigger("pageshow", {prevPage: $('')}) !== false ){
				reFocus($.mobile.startPage);
			}
		}
	});
})( jQuery );
