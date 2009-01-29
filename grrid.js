// Grrid v0.1.0
// Copyright (c) 2009 Swirrl IT Limited
// Grrid is provided under an MIT-licence.

// set up the namespace.
var grrid;
if (!grrid) grrid = {};

grrid.Grid = Class.create({

    // PRIVATE properties
    _selecting: false, // are we currently selecting?
    _selectedCells: [], // an array of the currently selected cell coordinates
    _selectStartCoords: null, // start and end coordinates of a selection
    _selectEndCoords: null,
    _selectedColumnIndex: null, // the index of the selected column, if any

    _checkingCells: false, // are we currently checking the cells?
    _intervalId: null, // the interval id used for the check-cells retry mechanism
    _checkCellsPeriodicalExecuter: null,

    _currentTopLeft: [0,0], // the coords of the cell at the top-left of the visible grid.
    _prevTopLeft: null, // the cell that was PREVIOUSLY at the top-left of the visible grid

    _numberOfCellsX: 0,
    _numberOfCellsY: 0,

    _visibleCells: null, // will store a VisibleCellCollection object.

    _lastFocusedInputCoords: null, // the last cell to have focus,
    _oldCellValue: null, // the old value of the recently changed cell
    _periodicalUpdater: null, // periodical updater for sending data to svr.
    
    // PUBLIC PROPERTIES

    editMode: false,

    cellHeight: 18,
    cellWidth: 100,

    viewportWidth: 800, // the width of the view port, defaulted to 800px
    viewportHeight: 300,
    outerDivBorderWidth: 1,
    highlightColor: "lemonChiffon",

    outerDiv: null,  // a reference to the outerDiv and innerDiv.
    innerDiv: null,

    lastFocusedCell: null, // the cell to last have focus
    changedCells: null, // will store a ChangedCellCollection object

    // CTOR:

    // constructor for Grid class.
    initialize: function(
        synchronizationUrl,
        cellDataUrl,
        saveUrl,
        innerDivSizeUrl,
        showUrl
    ){
            
        this.synchronizationUrl = synchronizationUrl;
        this._cellDataUrl = cellDataUrl;
        this._saveUrl = saveUrl;
        this._innerDivSizeUrl = innerDivSizeUrl;
        this._showUrl = showUrl;

        // initialize the changed and visible cells collecitons.
        this._visibleCells = new grrid.VisibleCellCollection(this);
        this.changedCellValues = new grrid.ChangedCellValueCollection(this);

        // call the function to set the inner div's size.
        this._setInnerDivSize();

        // get a ref to the outerDiv and innerdiv elements, as they're commonly req'd in the code.
        this.outerDiv = $('outerDiv');
        this.innerDiv = $('innerDiv');

        this._numberOfCellsX = this._getNumberOfCellsX();
        this._numberOfCellsY = this._getNumberOfCellsY();

        // reset the scrolling
        this.outerDiv.scrollTop = 0;
        this.outerDiv.scrollLeft = 0;

        // wire up event handlers
        this._wireEvents();

        // call check cells to populate the cells
        this._checkCells();

        // finally, calculate and show the row and col indicators
        this._generateRowIndicators();
        this._generateColumnIndicators();

        // start the periodical updater going.
        this._periodicalUpdater = new PeriodicalExecuter( function(){
            this.changedCellValues.synchronize();
        }.bind(this), 10 );
    },


    // store the changed cell value for a coord
    storeChangedCellValue: function(cell) {
        // add or update the value to the changed cells hash
        this.changedCellValues.update(cell.getX(), cell.getY(), cell.getValue());
    },

    // PUBLIC INSTANCE METHODS:

    // insert a cell into the grid
    insertCell: function(x, y, cellValue) {
        // make a cell, with the right coords and value
        var cell = new grrid.Cell(x, y);
        cell.setValue(cellValue);

        // add to our visible cells.
        this._visibleCells.add(x,y,cell);
    },

    // remove the cell at the coordinates given.
    removeCell: function(x,y) {
        this._visibleCells.remove(x,y);
    },


    // save the current state of the grid.
    saveData: function() {
        // stop the periodical updater.
        this._periodicalUpdater.stop();

        // first send any unsent data to the server (this is a blocking call).
        this.changedCellValues.synchronize();

        // now call the save method, synchronously.
        new Ajax.Request(this._saveUrl, {
            method: 'post',
            asynchronous: false,
            onSuccess: function() {
                // on success, redirect to just SHOWing the data set.
                window.location = this._showUrl;
            }
        });

    },

    // PRIVATE INSTANCE METHODS

    // a utility function to set the size of the inner div.
    _setInnerDivSize: function(){
        var url = this._innerDivSizeUrl;

        new Ajax.Request(url, {
            method: 'post',
            parameters: {
                cell_height: this.cellHeight,
                cell_width: this.cellWidth
            },
            asynchronous: false // do this synchronously as we don't want to get data until we've set the size.
        });
    },

    // wire up the events for this grid.
    _wireEvents: function(){

        // wire up observers, making sure we have the correct bindings. The first object we're passing
        // to the event listener is the current instance of our grid object (this).
        // see: http://alternateidea.com/blog/articles/2007/7/18/javascript-scope-and-binding
        // and: http://www.prototypejs.org/api/function/bindAsEventListener

        this.outerDiv.observe('scroll', this._processScroll.bindAsEventListener(this));
        this.outerDiv.observe('mousedown', this._mouseDown.bindAsEventListener(this));
        // we observe mouse movement anywhere, so that we can scroll by moving outside the grid
        Event.observe(document, 'mousemove', this._mouseMove.bindAsEventListener(this));
        this.outerDiv.observe('mouseup', this._mouseUp.bindAsEventListener(this));
    },

    // calculate and show the correct row indicators.
    _generateRowIndicators: function() {

        var startingRowNumber = Math.floor(this.outerDiv.scrollTop / this.cellHeight);
        var startingRowAdjustment = this.outerDiv.scrollTop%this.cellHeight;

        // calculate the number of visible rows.
        var numberOfVisibleRows = this._numberOfCellsY;

        // calc total number of rows.
        var innerDivHeight = parseInt(this.innerDiv.getStyle('height'));
        var totalNumberOfRows = innerDivHeight / this.cellHeight;

        // now insert the right cells into the div
        var rowIndicatorsDiv = $("rowIndicators");

        // first clear the div of any other stuff
        var currentRowIndicators = $$("div#rowIndicators div.rowIndicator");
        currentRowIndicators.each(function(item) {
            item.remove();
        }
        );

        var topPosition = (0 - startingRowAdjustment);
        for (var index = startingRowNumber; index < numberOfVisibleRows + startingRowNumber; ++index) {

            if (index < totalNumberOfRows) {
                var newIndicator = new Element('div', {
                    'class': 'rowIndicator'
                });

                newIndicator.setStyle({
                    padding: "0px",
                    margin: "0px",
                    top: topPosition.toString() + "px",
                    position: "absolute",
                    height:(this.cellHeight).toString() + "px"
                });

                newIndicator.update(index.toString());
                rowIndicatorsDiv.insert({
                    bottom: newIndicator
                });
                topPosition = topPosition + this.cellHeight;
            }
        }
    },

    // calculate and show the correct column indicators
    _generateColumnIndicators: function() {

        var startingColumnNumber = Math.floor(this.outerDiv.scrollLeft / this.cellWidth);
        var startingColumnAdjustment = this.outerDiv.scrollLeft%this.cellWidth;

        // calculate the number of visible cols.
        var numberOfVisibleColumns = this._numberOfCellsX;

        // calc total number of cols.
        var innerDivWidth = parseInt(this.innerDiv.getStyle('width'));
        var totalNumberOfCols = innerDivWidth / this.cellWidth;

        // now insert the right cells into the div
        var columnIndicatorsDiv = $("columnIndicators");

        // first clear the div of any other stuff:
        var currentColumnIndicators = $$("div#columnIndicators div.columnIndicator");
        currentColumnIndicators.each(function(item) {
            item.remove();
        }
        );

        var leftPosition = (0 - startingColumnAdjustment);

        for (var index = startingColumnNumber; index < numberOfVisibleColumns + startingColumnNumber; ++index) {

            if ( index < totalNumberOfCols ) {
                var newIndicator = new Element('div', {
                    'class': 'columnIndicator'
                });

                newIndicator.setStyle({
                    width: (this.cellWidth).toString() + "px",
                    padding: "0px",
                    margin: "0px",
                    left: leftPosition.toString() + "px",
                    position: "absolute",
                    height:"18px"
                });

                // wire up observers, making sure we have the correct bindings. The first object we're passing
                // to the event listener is the current instance of our grid object (this).
                // see: http://alternateidea.com/blog/articles/2007/7/18/javascript-scope-and-binding
                // and: http://www.prototypejs.org/api/function/bindAsEventListener
               
                newIndicator.observe('click', this._selectEntireColumn.bindAsEventListener(this, index) );

                newIndicator.update(grrid.Grid.calculateColumnName(index));

                columnIndicatorsDiv.insert({
                    bottom: newIndicator
                });
                leftPosition = leftPosition + this.cellWidth;
            }
        }

    },

    // this function works out what cells we should highlight.
    _highlightSelectedCells: function() {

        // first, set all the visible cells to be not highlighted.
        this._clearHighlightedCells();
  

        if(this._selectedColumnIndex != null){
            // there is a column selected.

            // highlight the cells in that column
            var queryString = '#innerDiv input.input-col' + this._selectedColumnIndex.toString();
            var cellsInColumn = $$(queryString);
           
            cellsInColumn.each(function(item) {
                item.setStyle({
                    backgroundColor: this.highlightColor
                });
            }.bind(this));

        }
        else {
            this._selectedCells.each(function(item) {  
                var inputName = grrid.Grid.generateInputNameFromCoords(item[0], item[1]);
                var theInput = $(inputName);
                if (theInput) {
                    theInput.setStyle({
                        backgroundColor: this.highlightColor
                    });
                }
            }.bind(this));
        }
    },

    // clear which cells are highlighted
    _clearHighlightedCells: function() {
        var visibleCellsInputs = $$('#innerDiv input.grid-cell-input');
        visibleCellsInputs.each(function(item) {
            item.setStyle({
                backgroundColor:'white'
            });
        });
    },

    _calculateSelectedCells: function(xStart, yStart, xEnd, yEnd) {
  
        // start off assuming at the end is larger than the start.
        var smallestX = xStart;
        var smallestY = yStart;
        var largestX = xEnd;
        var largestY = yEnd;

        // if our assumption is wrong, swap.
        if (xEnd < xStart) {
            smallestX = xEnd;
            largestX = xStart;
        }

        // likewise for Y coordinates
        if (yEnd < yStart) {
            smallestY = yEnd;
            largestY = yStart;
        }

        // reset the selected Cells array.
        this._selectedCells = [];
        var cellCounter = 0;

        // populate the selected cells..
        for (y = smallestY; y <= largestY; y++) {
            for (x = smallestX; x <= largestX; x++ ) {
                this._selectedCells[cellCounter++] = [x,y];
            }
        }

        this._highlightSelectedCells();
    },
    
    // what cell is under the passed mouse pixel coords?
    _calculateWhichCell: function(xCoord, yCoord) {
        // what's the scroll amounts?
        var scrollLeft = this.outerDiv.scrollLeft;
        var scrollTop = this.outerDiv.scrollTop;

        // adjust by the offset of the outerdiv compared to the client?
        var adjustedX = xCoord - this.outerDiv.offsetLeft - this.outerDivBorderWidth + scrollLeft;
        var adjustedY = yCoord - this.outerDiv.offsetTop - this.outerDivBorderWidth + scrollTop;

        // now, given the adjusted X and Y, work out which cell we are over
        var cellX = Math.abs(Math.floor(adjustedX / this.cellWidth));
        var cellY = Math.abs(Math.floor(adjustedY / this.cellHeight));

        // returns a cell position in format x,y
        return [cellX, cellY];

    },

    // This func call an ajax func to check cells when it's ok to do so
    _checkCells: function(){

        // if we're not already checking cells, just call the method
        if (!this._checkingCells) {
            this._checkCellsAjax();
        }
        else {
            if (this._checkCellsPeriodicalExecuter==null) {
                this._checkCellsPeriodicalExecuter = new PeriodicalExecuter(this._checkCellsAjax.bind(this), 0.3);
            }
        }
    },
    

    // a func to actually get the cell data from the server, via ajax.
    _checkCellsAjax: function(){
        
        if (!this._checkingCells)
        {
            // mark us as checking.
            this._checkingCells = true;

            if(this._checkCellsPeriodicalExecuter!=null){
                // now that we're in, stop retrying.
                this._checkCellsPeriodicalExecuter.stop();
                // wiping out the executer tells the
                // checkCells func that we're not waiting any more.
                this._checkCellsPeriodicalExecuter = null;
            }

            // get the current top left location.
            var outerDiv = $("outerDiv");
            var scrollX = outerDiv.scrollLeft;
            var scrollY = outerDiv.scrollTop;

            // the starting row and column of the cells.
            var startX = Math.abs(Math.floor(scrollX / this.cellWidth));
            var startY = Math.abs(Math.floor(scrollY / this.cellHeight));

            // if not at origin, subtract 1 to make it load the cells a bit early - for smoothness
            if (startX-2 >= 0) {
                startX=startX-1;
            }
            if (startY-2 >= 0) {
                startY=startY-1;
            }

            this._currentTopLeft = [startX,startY];

            if ((this._prevTopLeft==null) ||
                (this._prevTopLeft[0] != this._currentTopLeft[0] || this._prevTopLeft[1] != this._currentTopLeft[1])) {

                // here, we want to send an ajax request to the server,
                // to request the new bunch of cells.
                var url = this._cellDataUrl;

                // set the params.
                var ajaxParams = $H({
                    new_x: this._currentTopLeft[0],
                    new_y: this._currentTopLeft[1],
                    number_of_cells_x: this._numberOfCellsX,
                    number_of_cells_y: this._numberOfCellsY
                });

                // if the prevTopLeft variable has a value, add the old x and y coords to the request.
                if(this._prevTopLeft) {
                    ajaxParams.update( {
                        old_x: this._prevTopLeft[0],
                        old_y: this._prevTopLeft[1]
                    } );
                }


                new Ajax.Request(url, {
                    method: 'post',
                    parameters: ajaxParams,
                    // for some reason, if we use onSuccess here, the highlighting doesn't work!
                    onComplete: function(transport) {                      
                        // if we have a selection saved, (but we're not CURRENTLY selecting)
                        // work out which cells need to be highlighted
                        if(this._selectedCells.length > 0 && !this._selecting) {
                            this._calculateSelectedCells(this._selectStartCoords[0], this._selectStartCoords[1], this._selectEndCoords[0], this._selectEndCoords[1]);
                        }
                        if(this._selectedColumnIndex){
                            highlightSelectedCells();
                        }
                        this._prevTopLeft = this._currentTopLeft;
                        this._checkingCells = false; // mark us as not checking any more.
                    }.bind(this) // bind to the current instance!
                });
            }
            else {
                // it's the same location - don't bother checking.
                this._checkingCells = false;
            }
        } 
    },

    // utility funcs to work out the number of cells x and y.
    _getNumberOfCellsX: function() {
        var noOfCells = Math.ceil(this.viewportWidth / this.cellWidth) +2;
        return noOfCells;
    },
    _getNumberOfCellsY: function() {
        var noOfCells = Math.ceil(this.viewportHeight / this.cellHeight) +2;
        return noOfCells;
    },

    // deal with the mouse button being pressed over our grid.
    _mouseDown: function(event) {
        // are we in the cell area?
        if ( (Event.pointerX(event) > this.outerDiv.offsetLeft && Event.pointerX(event) < (this.outerDiv.offsetLeft + this.viewportWidth) ) &&
            (Event.pointerY(event)  > this.outerDiv.offsetTop && Event.pointerY(event) < (this.outerDiv.offsetTop + this.viewportHeight) )) {
            // if so, clear out the selected area
            // (if not, we're either outside of the grid, or in the scrollbar, so we wanna keep the selection.)
            this._selectedColumnIndex = null;
            this._selectedCells = [];
            this._clearHighlightedCells();
        }

        if(event.shiftKey) {
            this._startSelect(event);
        }

    },


    // deal with the mouse being moved about (only has any effect if currently selecting)
    _mouseMove: function(event) {
        if (this._selecting) {

            var cellCoords = this._calculateWhichCell(Event.pointerX(event), Event.pointerY(event));

            this._calculateSelectedCells(this._selectStartCoords[0], this._selectStartCoords[1], cellCoords[0], cellCoords[1]);

            this._scrollIfNearEdge(Event.pointerX(event), Event.pointerY(event));
            // make sure that we don't select the cells' text
            // (note that IE needs this here)
            Event.stop(event);
        }
    },

    // if the coords passed are near the edge of the viewport, do some scrollin'
    _scrollIfNearEdge: function(x,y) {
        var scrollIncrement = 20; // how much to scroll by.
        var scrollSensitivity = 20; // this is the size of the area near the edge of the viewport within which we want to cause a scroll

        // work out the ranges of coordinates within which we want to scroll.

        if ( x < this.outerDiv.offsetLeft + scrollSensitivity){
            // scroll left a bit
            this.outerDiv.scrollLeft = this.outerDiv.scrollLeft - scrollIncrement;
        }

        if ( x > (this.outerDiv.offsetLeft + this.viewportWidth - scrollSensitivity)){
            // scroll right a bit
            this.outerDiv.scrollLeft = this.outerDiv.scrollLeft + scrollIncrement;
        }

        if (y > this.outerDiv.offsetTop && x < this.outerDiv.offsetTop + scrollSensitivity){
            // scroll up a bit
            this.outerDiv.scrollTop = this.outerDiv.scrollTop - scrollIncrement;
        }

        if (y < (this.outerDiv.offsetTop + this.viewportHeight) && y > (this.outerDiv.offsetTop + this.viewportHeight - scrollSensitivity)){
            // scroll down a bit

            this.outerDiv.scrollTop = this.outerDiv.scrollTop + scrollIncrement;
        }

    },

    // start making a selection of cells
    _startSelect: function(event) {
       
        var cellCoords = this._calculateWhichCell(Event.pointerX(event), Event.pointerY(event));

        this._selectStartCoords = cellCoords;
        this._selectEndCoords = null;
        this._calculateSelectedCells(this._selectStartCoords[0], this._selectStartCoords[1], cellCoords[0], cellCoords[1]);

        this._selecting = true;

        // make sure that we don't select the cells' text
        // (note that FF and Saf needs this here)
        Event.stop(event);
        return false;

    },

    // deal with the mouse button being un-depressed over our grid
    _mouseUp: function(event) {
        // if we're selecting, finalise the selction.
        if (this._selecting) {
            var cellCoords = this._calculateWhichCell(Event.pointerX(event), Event.pointerY(event));
            this._selectEndCoords = cellCoords;
            this._calculateSelectedCells(this._selectStartCoords[0], this._selectStartCoords[1], cellCoords[0], cellCoords[1]);
        }
;
        this._selecting = false;
    },

    // select a whole col: this is an event handler for the column indicator being clicked.
    _selectEntireColumn: function(event) {

        var data = $A(arguments);
        data.shift(); // the next param is the column index.
        var columnIndex = data[0];

        // deselected any selected cell area
        this._selectedCells = [];

        // if they re-clicked on the currently selected column,
        // they are trying to unselect it.
        if (this._selectedColumnIndex != null
            && this._selectedColumnIndex == columnIndex) {
            this._selectedColumnIndex = null;
        }
        else {
            this._selectedColumnIndex = columnIndex;
        }

  
        // after remembering which column is selected, do the highlighting
        this._highlightSelectedCells();
    },


    // what to do when we get a scroll event
    _processScroll: function(event) {
        this._generateColumnIndicators();
        this._generateRowIndicators();
        this._checkCells();
    }



});

// add some class methods to grrid.Grid
// ==============================

grrid.Grid.generateCellNameFromCoords = function(xCoord, yCoord){
    return "cell_x" + xCoord.toString() + "y" + yCoord.toString();
}

grrid.Grid.generateInputNameFromCoords = function(xCoord, yCoord){
    return "input_x" + xCoord.toString() + "y" + yCoord.toString();
}

grrid.Grid.calculateColumnName = function(index){

    // First, work out what the final letter should be:
    var finalLetterModulo = (index+1)%26;
    var finalLetter = "Z";

    if(finalLetterModulo!=0){
        finalLetter = String.fromCharCode(65+finalLetterModulo-1);
    }

    // Now work out if the column needs a prefix letter.
    var prefixNo = Math.floor(index/26);
    var prefixLetter = "";
    if(prefixNo!=0){
        prefixLetter = String.fromCharCode(65+prefixLetter);
    }

    // We don't bother going any higher than a series of two chars
    // TODO: restrict the number of cols on the server to less than 26*26
    return prefixLetter + finalLetter;

}

// class to represent a grid cell.
grrid.Cell = Class.create({

    // PUBLIC properties

    _x: null, // x coord of cell
    _y: null, // y coord of cell
    _value: null, // the value in the cell

    _oldValue: null,
    
    // cell name and input name
    _cellName: "",
    _inputName: "",

    // constructor for Cell class.
    // pass in the coords, and a ref to the grid to which it belogns.
    initialize: function(xCoord, yCoord) {
        this._x = parseInt(xCoord);
        this._y = parseInt(yCoord);

        // set the html control-name props.
        this._cellName = grrid.Grid.generateCellNameFromCoords(xCoord,yCoord);
        this._inputName = grrid.Grid.generateInputNameFromCoords(xCoord,yCoord);
    },

    getX: function(){
        return this._x;
    },

    getY: function(){
        return this._y;
    },

    getValue: function(){
        return this._value;
    },

    // set the value of thiscell
    setValue: function(theValue){
        this._value = theValue;
    },

    // add this cell to the grid passed.
    addToGrid: function(grid) {
        
        var cellClass = "grid-cell cell-row" + this._y.toString() + " cell-col" + this._x.toString();
        var inputClass = "grid-cell-input input-row" + this._y.toString() + " input-col" + this._x.toString();

        // before isnerting, check for unsynched data for this cell
        var unsynchedCellValue = grid.changedCellValues.getValue(this._x,this._y);        
        if (unsynchedCellValue != null){
            this.setValue(unsynchedCellValue);
        }

        // make the input
        var theInput = new Element('input', {
            'class': inputClass,
            'id': this._inputName,
            'value': this._value,
            'maxLength': 255, // default max length is 255 to support default varchar length with rails.
            'tabIndex': ((this._y+1) * 1000) + (this._x) // assume never more than 1000 cols!
        });

        // wire up observers, making sure we have the correct bindings. The first object we're passing
        // to the event listener is the current instance of our cell object (this).
        // see: http://alternateidea.com/blog/articles/2007/7/18/javascript-scope-and-binding
        // and: http://www.prototypejs.org/api/function/bindAsEventListener
        theInput.observe('focus', this._textFieldFocus.bindAsEventListener(this, grid) );
        theInput.observe('blur', this._textFieldBlur.bindAsEventListener(this, grid) );

        // make the cell readonly if the grid is not in edit mode
        if(!grid.editMode) {
            theInput.writeAttribute('readonly', 'readonly');
        }

        // set the input's style.
        theInput.setStyle({
            height: (grid.cellHeight-2).toString() + "px",
            width: (grid.cellWidth-1).toString() + "px"
        });

        // make the cell and whack the input inside it.
        var theCell = new Element('div', {
            'class': cellClass,
            'id': this._cellName
        }
        ).update(theInput);

        // set the cell's style
        theCell.setStyle({
            left: (this._x * grid.cellWidth).toString() + "px",
            top: (this._y * grid.cellHeight).toString() + "px",
            height: grid.cellHeight.toString() + "px",
            width: grid.cellWidth.toString() + "px"
        });

        // just insert at the start of the inner div.
        grid.innerDiv.insert({
            bottom:theCell
        });
    },

    // is the cell passed the same cell as THIS one.
    // i.e. do the coords match
    isSameCell: function(cell) {
        if (cell.getX() == this._x && cell.getY() == this._y) {
            return true;
        }
        return false;
    },

    // remove the cell from the grid passed
    removeFromGrid: function(grid) {    
        var cellName = grrid.Grid.generateCellNameFromCoords(this._x, this._y);
        var thisCell = $(cellName);
        
        // if this cell was the last one to gain focus, make sure we store any changes to it before removing it.
        if (grid.lastFocusedCell != null && this.isSameCell(grid.lastFocusedCell)) {
            var theInput = thisCell.down('input');
            this._value = theInput.value;
            if (this.hasChanges()){
                grid.storeChangedCellValue(this);
            }
        }
        
        // actually do the removal from the dom
        thisCell.remove();

    },

    // work out if this cell has changed.
    hasChanges: function(){
        if (this._oldValue != this._value ){
            return true;
        }
        return false;
    },

    // deal with a this cell's field losing focus.
    _textFieldBlur: function(event) {
        var element = Event.element(event);

        // the grid is passed as the 2nd param
        var grid = $A(arguments)[1];
        this.setValue(element.value);

        if (this.hasChanges()){
            grid.storeChangedCellValue(this);
        }
    },

    // deal with this cell's text field attaining focus
    _textFieldFocus: function(event) {
        var element = Event.element(event);

        // the grid is passed as the 2nd param
        var grid = $A(arguments)[1];

        grid.lastFocusedCell = this;
        this._oldValue = element.value; // remember the value this cell started with.
    }

}
);

// class to represent the collection of visible cells in a grid
grrid.VisibleCellCollection = Class.create({

    // at its core this colleciton has a hash
    // which maps coordinates to actual cells
    _visibleCells: $H({}),
    _grid: null,

    // ctor for the visible cell collection class.
    initialize: function(grid) {
        this._grid = grid;
    },

    // add a cell to the collection, and the grid
    add: function(x,y,cell) {
        this._visibleCells.set([x,y], cell);
        cell.addToGrid(this._grid);
    },

    // removes a cell from the collection
    remove: function(x,y) {
        var cellToRemove = this.getCell(x,y);
        cellToRemove.removeFromGrid(this._grid);
        this._visibleCells.unset([x,y]);     
    },

    // get the cell from the collection, at the given coords
    getCell: function(x,y) {    
        return this._visibleCells.get([x,y]);
    }
    
});



grrid.ChangedCellValueCollection = Class.create({

    // at its core, this collection has a hash
    // which maps coordinates to values (not cells.
    _changedCellValues: $H({}),

    _grid: null,

    // ctor for the visible cell collection class.
    initialize: function(grid) {
        this._grid = grid;
    },

    // update the value of a cell in the collection
    update: function(x,y, cellValue) {
        this._changedCellValues.set([x,y], cellValue);
    },

    // removes a cell from the collection
    remove: function(x,y) {
        this._changedCellValues.unset([x,y]);
    },

    // get the cell from the collection, at the given coords.
    getValue: function(x,y) {
        return this._changedCellValues.get([x,y]);
    },

    // synchronize this collection with the server.
    synchronize: function(){
        
        // only bother doing anything if there are any changed cells.
        if (this._changedCellValues.keys().length > 0) {

            // clone the changed Cells hash
            var changedCellsToSend = this._changedCellValues.clone();

            // notice that we call this synchronously, so that
            // we only get one at a time (the periodical updater takes care of that).
            new Ajax.Request(this._grid.synchronizationUrl, {
                method: 'post',
                parameters: changedCellsToSend, // just whack the changed cells in.
                asynchronous: false,
                onSuccess: function() {
                    // loop through the cells we sent to the server,
                    // and delete the entries in the 'changed cells' hash...
                    // but only where the values are still the same as what we sent.
                    // (if not it means that cell's been updated again).
                    changedCellsToSend.each(function(pair) {
                        // Note: I don't think that the hash can change between the check and
                        // the unset as js is single threaded.
                        if (this._changedCellValues.get(pair.key) == changedCellsToSend.get(pair.key)) {
                            this._changedCellValues.unset(pair.key);
                        }
                    }.bind(this)); // bind to the current instance, for correct use of 'this'
                }.bind(this) // bind to the current instance, for correct use of 'this'
            });
        }

    }

});
