// Grrid v0.2.0
// Copyright (c) 2009 Swirrl IT Limited
// Grrid is provided under an MIT-licence.

// set up the namespace.
var grrid;
if (!grrid) grrid = {};

grrid.Grid = Class.create({

    // PRIVATE properties
    _checkingCells: false, // are we currently checking the cells?
    _intervalId: null, // the interval id used for the check-cells retry mechanism
    _checkCellsPeriodicalExecuter: null,
    _generateIndicatorsPeriodicalExecuter: null,
    _currentTopLeft: [0,0], // the coords of the cell at the top-left of the visible grid.
    _prevTopLeft: null, // the cell that was PREVIOUSLY at the top-left of the visible grid
    _visibleCells: null, // will store a VisibleCellCollection object.
    _oldCellValue: null, // the old value of the recently changed cell
    _periodicalUpdater: null, // periodical updater for sending data to svr.

    // PUBLIC PROPERTIES
    visibleColumns: null, // will store a VisibleColumnCollection object. 
    selectedColumn: null, // the column that's currently selected, if any.
    cellHeight: 18,
    cellWidth: 100,
    viewportWidth: 780, // the width and height of the view port, with defaults
    viewportHeight: 280,
    outerDivBorderWidth: 1,
    outerDiv: null,  // a reference to the outerDiv and innerDiv.
    innerDiv: null,
    lastFocusedCell: null, // the cell to last have focus
    changedCells: null, // will store a ChangedCellCollection object

    // CTOR:

    // constructor for Grid class.
    initialize: function() {
    },
    
    // PUBLIC INSTANCE METHODS:

    // actually do the work of setting up the grid.
    // we don't do this in the ctor, as some of the set up requires the instance to exist first
    setUpGrid: function(
        synchronizationUrl,
        cellDataUrl,
        saveUrl,
        setGridExtentUrl
        ){

        this.synchronizationUrl = synchronizationUrl;
        this._cellDataUrl = cellDataUrl;
        this._saveUrl = saveUrl;
        this._setGridExtentUrl = setGridExtentUrl;

        // initialize the changed and visible cells collecitons.
        this.visibleColumns = new grrid.VisibleColumnCollection(this);
        this._visibleCells = new grrid.VisibleCellCollection(this);
        this.changedCellValues = new grrid.ChangedCellValueCollection(this);

        // call the function to set the inner div's size.
        this._setGridExtent();

        // get a ref to the outerDiv and innerdiv elements, as they're commonly req'd in the code.
        this.outerDiv = $('outerDiv');
        this.innerDiv = $('innerDiv');

        // reset the scrolling
        this.outerDiv.scrollTop = 0;
        this.outerDiv.scrollLeft = 0;

        // wire up event handlers
        this._wireEvents();

        this.setRowIndicatorsWidth();

        // note that this has the side effect of generating the column indicators and getting all the cells.
        this._setViewPortSize();

        // start the periodical updater going, for synching cell values with server
        this._periodicalUpdater = new PeriodicalExecuter( function(){
            this.changedCellValues.synchronize();
        }.bind(this), 10 );
    },

    getTotalNumberOfRows: function() {
        var innerDivHeight = parseInt(this.innerDiv.getStyle('height'));
        return innerDivHeight / this.cellHeight;
    },

    getTotalNumberOfColumns: function() {
        var innerDivWidth = parseInt(this.innerDiv.getStyle('width'));
        return innerDivWidth / this.cellWidth;
    },


    // set the width of the row indicators div
    setRowIndicatorsWidth: function() {

        var noOfChars = this.getTotalNumberOfRows().toString().length;
        var charWidth = 10;
        var totalWidth = noOfChars*charWidth + 20;

        var rowIndicators = $('outerRowIndicatorsDiv');
        rowIndicators.setStyle({
            width: totalWidth + 'px'
        });

        var rowIndicatorsMargin = parseInt(rowIndicators.getStyle('marginLeft'));
        totalWidth += rowIndicatorsMargin;

        $('outerColumnIndicatorsDiv').setStyle({
            marginLeft: (totalWidth + 2).toString() + 'px'
        });

    },


    // store the changed cell value for a coord
    storeChangedCellValue: function(cell) {
        // add or update the value to the changed cells hash
        this.changedCellValues.update(cell.getX(), cell.getY(), cell.getValue());
    },


    // insert a cell into the grid
    // returns the cell itself.
    insertCell: function(x, y, cellValue) {
        // make a cell, with the right coords and value
        var cell = new grrid.Cell(x, y);
        cell.setValue(cellValue);

        // add to our visible cells.
        this._visibleCells.add(x,y,cell);

        return cell;
    },

    // remove the cell at the coordinates given.
    removeCell: function(x,y) {
        this._visibleCells.remove(x,y);
    },


    // insert a column into our collection of known columns
    insertColumn: function(position) {
        var column = new grrid.Column(position);
        this.visibleColumns.add(position, column);
        return column;
    },

    // remove a column from our collection of known cols
    removeColumn: function(position) {
        this.visibleColumns.remove(position);
    },


    // save the current state of sthe grid.
    saveData: function() {
        // stop the periodical updater.
        this._periodicalUpdater.stop();

        // first send any unsent data to the server (this is a blocking call).
        this.changedCellValues.synchronize();

        // now call the save method, synchronously.
        new Ajax.Request(this._saveUrl, {
            method: 'post',
            asynchronous: false
        });

    },

    setVerticalExtent: function(verticalExtentInPx) {
        $('innerDiv').setStyle({ 
            height: verticalExtentInPx.toString() + 'px'
        });
        $('innerRowIndicatorsDiv').setStyle({ 
            height: verticalExtentInPx.toString() + 'px'
        });
    },

    setHorizontalExtent: function(horizontalExtentInPx) {
        $('innerDiv').setStyle({ 
            width: horizontalExtentInPx.toString() + 'px'
        });
        $('innerColumnIndicatorsDiv').setStyle({ 
            width: horizontalExtentInPx.toString() + 'px'
        });
    },
    
    // PRIVATE INSTANCE METHODS

    _startSyncPeriodicalUpdater: function() {
        // start the periodical updater going.
        this._periodicalUpdater = new PeriodicalExecuter( function(){
            this.changedCellValues.synchronize();
        }.bind(this), 10 );
    },

    _stopSyncPeriodicalUpdater: function() {
        this._periodicalUpdater.stop();
    },

    _windowResize: function(event) {
        this._setViewPortSize();
    },

    _setViewPortSize: function() {

        if (this.lastFocusedCell != null) {
            // force loss of focus of the currently focused cell - this will cause it's value to be stored if it's changed.
            var focusedInputName = grrid.Grid.generateInputNameFromCoords(this.lastFocusedCell.getX(), this.lastFocusedCell.getY() );
            var focusedInput = $(focusedInputName);
            if (focusedInput != null) {
                focusedInput.blur();
            }
        }

        this._setOuterDivSize();

        // make the row and col indicators
        this._generateIndicators();

        // whenever the outer div size changes, also set the grid progress location accordingly too.
        var gridProgress = $('gridProgress');

        var gridProgressWidth = parseInt(gridProgress.getStyle('width'));
        var gridProgressHeight = parseInt(gridProgress.getStyle('height'));

        var offsetLeft = this.outerDiv.offsetLeft + (this.viewportWidth / 2) - (gridProgressWidth / 2 );
        var offsetTop = this.outerDiv.offsetTop + (this.viewportHeight / 2) - (gridProgressHeight / 2 );

        gridProgress.setStyle({
            left: offsetLeft+'px',
            top: offsetTop+'px'
        });

        // populate the grid
        this._redrawGridContents();
    },

    _setOuterDivSize: function() {
      // override to customize the setting of the outer div's size
    },

    _redrawGridContents: function() {

        var cells = $$('.grid-cell');

        // remove all teh cells.
        cells.each( function(cell) {
            cell.remove();
        });

        // null out the previous top left coordinate.  this allows us to get the cells even though we've not moved.
        this._prevTopLeft = null;

        // call check cells to populate the cells
        this._checkCells();

    },

    // a utility function to set the size of the inner div.
    _setGridExtent: function(){
        var url = this._setGridExtentUrl;

        new Ajax.Request(url, {
            method: 'get',
            parameters: {
                cell_height: this.cellHeight,
                cell_width: this.cellWidth
            },
            asynchronous: false // do this synchronously as we don't want to get data until we've set the size.
        });
    },

    // wire up the events for this grid.
    _wireEvents: function(){
        this.outerDiv.observe('scroll', this._processScroll.bindAsEventListener(this));
        this.outerDiv.observe('mousedown', this._mouseDown.bindAsEventListener(this));
        Event.observe(window, 'resize', this._windowResize.bindAsEventListener(this));
    },


    // calculate and show the correct row indicators.


    // returns an array of column positions that should be visible, based on the current scrollage.
    _getVisibleColumnIndicators: function() {

        var outerColumnIndicatorsDiv = $('outerColumnIndicatorsDiv');

        var scrollX = outerColumnIndicatorsDiv.scrollLeft;
        var startingColumn = Math.abs(Math.floor(scrollX / this.cellWidth));

        // if not at origin, subtract 1 to make it load the cells a bit early - for smoothness
        if (startingColumn-1 >= 0) startingColumn=startingColumn-1

        // this is the actual number of cells in the grid.
        var totalIndicators = this.getTotalNumberOfColumns();
        var numberOfVisibleColumns = this._getNumberOfCellsX() + 2;
        var visibleColumnIndicatorsArray = [];

        counter = 0;
        for (var index = startingColumn; index < numberOfVisibleColumns + startingColumn; index++) {
            if ( index < totalIndicators ) {
                visibleColumnIndicatorsArray[counter++] = index;
            }
        }

        return visibleColumnIndicatorsArray;
              
    },

    _getVisibleRowIndicators: function() {

        var outerRowIndicatorsDiv = $('outerRowIndicatorsDiv');

        var scrollY = outerRowIndicatorsDiv.scrollTop;
        var startingRow = Math.abs(Math.floor(scrollY / this.cellHeight));

        // if not at origin, subtract 1 to make it load the cells a bit early - for smoothness
        if (startingRow-1 >= 0) startingRow=startingRow-1

        // this is the actual number of cells in the grid.
        var totalIndicators = this.getTotalNumberOfRows();
        var numberOfVisibleRows = this._getNumberOfCellsY() + 3;
        var visibleRowIndicatorsArray = [];

        counter = 0;
        for (var index = startingRow; index < numberOfVisibleRows + startingRow; index++) {
            if ( index < totalIndicators ) {
                visibleRowIndicatorsArray[counter++] = index;
            }
        }

        return visibleRowIndicatorsArray;
        
    },


    // calculate and show the correct column indicators
    _checkColumnIndicators: function() {

        var outerColumnIndicatorsDiv = $('outerColumnIndicatorsDiv');

        // first, set the scroll to match that of the outer div.
        outerColumnIndicatorsDiv.scrollLeft = this.outerDiv.scrollLeft;
        var visibleColumnIndicators = this._getVisibleColumnIndicators();

        // add each indicator to the column indicators inner div.
        var innerColumnIndicatorsDiv = $('innerColumnIndicatorsDiv');

        var visibleColumnIndicatorsMap = {};

        for (i = 0; i < visibleColumnIndicators.length; i++) {
            
            var columnIndicatorIndex = visibleColumnIndicators[i];
            var columnIndicatorName = "columnIndicator-" + columnIndicatorIndex;
            visibleColumnIndicatorsMap[columnIndicatorName] = true;
            var columnIndicatorDiv = $(columnIndicatorName);

            // now add the indicator if it's not already there.
            if (!columnIndicatorDiv) {
                this._generateColumnIndicator(columnIndicatorIndex, (columnIndicatorIndex * this.cellWidth) );
            }
        }

        // remove unncessary ones
        var existingColumnIndicators = innerColumnIndicatorsDiv.select('div.columnIndicator');
        existingColumnIndicators.each( function(indicator) {
            if(!visibleColumnIndicatorsMap[indicator.id]) {
                indicator.remove();
            }
        });
    },

    _checkRowIndicators: function() {

        var outerRowIndicatorsDiv = $('outerRowIndicatorsDiv');

        // first, set the scroll to match that of the outer div.
        outerRowIndicatorsDiv.scrollTop = this.outerDiv.scrollTop;
        var visibleRowIndicators = this._getVisibleRowIndicators();

        // add each indicator to the column indicators inner div.
        var innerRowIndicatorsDiv = $('innerRowIndicatorsDiv');

        var visibleRowIndicatorsMap = {};

        for (i = 0; i < visibleRowIndicators.length; i++) {

            var rowIndicatorIndex = visibleRowIndicators[i];
            var rowIndicatorName = "rowIndicator-" + rowIndicatorIndex;
            visibleRowIndicatorsMap[rowIndicatorName] = true;
            var rowIndicatorDiv = $(rowIndicatorName);

            // now add the indicator if it's not already there.
            if (!rowIndicatorDiv) {
                this._generateRowIndicator(rowIndicatorIndex, (rowIndicatorIndex * this.cellHeight) );
            }
        }

        // remove unncessary ones
        var existingRowIndicators = innerRowIndicatorsDiv.select('div.rowIndicator');
        existingRowIndicators.each( function(indicator) {
            if(!visibleRowIndicatorsMap[indicator.id]) {
                indicator.remove();
            }
        });

    },

    // function to generate just one col indicator.  returns the new indicator.
    _generateColumnIndicator: function(index, leftPosition) {
        var newIndicator = new Element('div', {
            'id': 'columnIndicator-' + index.toString(),
            'class': 'columnIndicator'
        });

        newIndicator.setStyle({
            width: (this.cellWidth).toString() + "px",
            padding: "0px",
            margin: "0px",
            left: leftPosition.toString() + "px",
            position: "absolute"
        });

        newIndicator.update(grrid.Grid.calculateColumnName(index));

        $("innerColumnIndicatorsDiv").insert({
            bottom: newIndicator
        });

        return newIndicator;
    },

    // function to generate just one row indicator.  returns the new indicator.
    _generateRowIndicator: function(index, topPosition) {
        var newIndicator = new Element('div', {
            'id': 'rowIndicator-' + index.toString(),
            'class': 'rowIndicator'
        });

        newIndicator.setStyle({
            padding: "0px",
            margin: "0px",
            top: topPosition.toString() + "px",
            position: "absolute",
            height:(this.cellHeight).toString() + "px"
        });

        newIndicator.update((index+1).toString());
        $("innerRowIndicatorsDiv").insert({
            bottom: newIndicator
        });

        return newIndicator;
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
    
    _generateIndicators: function() {
        this._checkColumnIndicators();
        this._checkRowIndicators();
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

            this._showHideFetchingDataIndicator(true);

            // get the current top left location.
            var outerDiv = this.outerDiv;
            var scrollX = outerDiv.scrollLeft;
            var scrollY = outerDiv.scrollTop;

            // the starting row and column of the cells.
            var startX = Math.abs(Math.floor(scrollX / this.cellWidth));
            var startY = Math.abs(Math.floor(scrollY / this.cellHeight));

            // if not at origin, subtract 1 to make it load the cells a bit early - for smoothness
            if (startX-1 >= 0) startX=startX-1;
            if (startY-1 >= 0) startY=startY-1;
        
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
                    number_of_cells_x: this._getNumberOfCellsX()+2,
                    number_of_cells_y: this._getNumberOfCellsY()+2
                });

                // if the prevTopLeft variable has a value, add the old x and y coords to the request.
                if(this._prevTopLeft) {
                    ajaxParams.update( {
                        old_x: this._prevTopLeft[0],
                        old_y: this._prevTopLeft[1]
                    } );
                }


                new Ajax.Request(url, {
                    method: 'get',
                    parameters: ajaxParams,
                    onCreate: function(transport) {
                        this._checkCellsAjaxCreate(transport);
                    }.bind(this),
                    onComplete: function(transport) {
                        this._checkCellsAjaxComplete(transport);
                    }.bind(this) // bind to the current instance!
                });
            }
            else {
                // it's the same location - don't bother checking.
                this._checkingCells = false;
                this._showHideFetchingDataIndicator(false);
            }
        }
    },

    // override if you want to do something special when starting to check cells.
    _checkCellsAjaxCreate: function(transport) {
	  // by default, this does nothing.	
    },

    _checkCellsAjaxComplete: function(transport) {
        this._prevTopLeft = this._currentTopLeft;
        this.visibleColumns.rewireEvents();
        this._checkingCells = false; // mark us as not checking any more.
        this._showHideFetchingDataIndicator(false);
    },

    _showHideFetchingDataIndicator: function(show) {
        if (show){
            $('gridProgress').show();
        }
        else {
            // otherwise just hide it.
            $('gridProgress').hide();
        }
    },

    // utility funcs to work out the number of cells x and y.
    _getNumberOfCellsX: function() {
        var noOfCells = Math.ceil(this.viewportWidth / this.cellWidth);
        return noOfCells;
    },
    _getNumberOfCellsY: function() {
        var noOfCells = Math.ceil(this.viewportHeight / this.cellHeight);
        return noOfCells;
    },

    // deal with the mouse button being pressed over our grid.
    _mouseDown: function(event) {
        // are we in the cell area?
        if ( (Event.pointerX(event) > this.outerDiv.offsetLeft && Event.pointerX(event) < (this.outerDiv.offsetLeft + this.viewportWidth) ) &&
            (Event.pointerY(event)  > this.outerDiv.offsetTop && Event.pointerY(event) < (this.outerDiv.offsetTop + this.viewportHeight) )) {
            // if so, clear out the selected column
            // (if not, we're either outside of the grid, or in the scrollbar, so we wanna keep the selection.)
            this.selectedColumn = null;
        }

    },
   
    // what to do when we get a scroll event
    _processScroll: function(event) {
        this._generateIndicators();
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

    // We don't bother going any higher than a series of two chars, due to limit of 500 cols on svr.
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
           
        // before isnerting, check for unsynched data for this cell
        var unsynchedCellValue = grid.changedCellValues.getValue(this._x,this._y);
        if (unsynchedCellValue != null){
            this.setValue(unsynchedCellValue);
        }

        // make the input
        var theInput = new Element('input', {
            'id': this._inputName,
            'value': this._value,
            'maxLength': 255 // default max length is 255 to support default varchar length with rails.
        // don't worry about tab order - we deal with that via events
        });

        this._setInputClass(grid, theInput);
        
        // wire up observers, making sure we have the correct bindings. The first object we're passing
        // to the event listener is the current instance of our cell object (this).
        // see: http://alternateidea.com/blog/articles/2007/7/18/javascript-scope-and-binding
        // and: http://www.prototypejs.org/api/function/bindAsEventListener
        theInput.observe('focus', this._textFieldFocus.bindAsEventListener(this, grid) );
        theInput.observe('blur', this._textFieldBlur.bindAsEventListener(this, grid) );
        theInput.observe('keydown', this._textFieldKeyDown.bindAsEventListener(this, grid) );

        // set the input's style.
        theInput.setStyle({
            height: (grid.cellHeight-1).toString() + "px",
            width: (grid.cellWidth-1).toString() + "px"
        });

        var cellClass = "grid-cell cell-row" + this._y.toString() + " cell-col" + this._x.toString();

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

    _setInputClass: function(grid, theInput) {
        theInput.addClassName('grid-cell-input');
        theInput.addClassName('input-row' + this._y.toString());
        theInput.addClassName('input-col' + this._x.toString());
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
    _textFieldFocus: function(event, grid) {
        var element = Event.element(event);

        grid.lastFocusedCell = this;
        this._oldValue = element.value; // remember the value this cell started with.

        // scroll if near the edge of the cells actually visible in the view port.
        var min_x = grid._currentTopLeft[0]+1;
        var min_y = grid._currentTopLeft[1]+1;
        var max_x = grid._currentTopLeft[0] + grid._getNumberOfCellsX()-1;
        var max_y = grid._currentTopLeft[1] + grid._getNumberOfCellsY()-1;

        if (this.getX() <= (min_x)) {
            grid.outerDiv.scrollLeft = grid.outerDiv.scrollLeft - grid.cellWidth;
        }
        else if (this.getX() >= (max_x)) {
            grid.outerDiv.scrollLeft = grid.outerDiv.scrollLeft + grid.cellWidth;
        }

        if (this.getY() <= (min_y)) {
            grid.outerDiv.scrollTop = grid.outerDiv.scrollTop - grid.cellHeight;
        }
        else if (this.getY() >= (max_y)) {
            grid.outerDiv.scrollTop = grid.outerDiv.scrollTop + grid.cellHeight;
        }


    },
    
    _textFieldKeyDown: function(event) {
        
        if (event.keyCode == Event.KEY_DOWN || event.keyCode == Event.KEY_RETURN) {
            Event.stop(event);
            var inputDown = $( grrid.Grid.generateInputNameFromCoords( this.getX(), this.getY()+1 ));
            if (inputDown != null) {
                Form.Element.activate(inputDown);
            }

        }
        else if(event.keyCode == Event.KEY_UP) {
            Event.stop(event);
            var inputUp = $( grrid.Grid.generateInputNameFromCoords( this.getX(), this.getY()-1 ));
            if (inputUp != null) {
                Form.Element.activate(inputUp);
            }
        }
        else if(event.keyCode == Event.KEY_RIGHT || event.keyCode == Event.KEY_TAB ) {
            Event.stop(event);
            var inputRight = $( grrid.Grid.generateInputNameFromCoords( this.getX()+1, this.getY() ));
            if (inputRight != null) {
                Form.Element.activate(inputRight);
            }
            
        }
        else if(event.keyCode == Event.KEY_LEFT) {
            Event.stop(event);
            var inputLeft = $( grrid.Grid.generateInputNameFromCoords( this.getX()-1, this.getY() ));
            if (inputLeft != null) {
                Form.Element.activate(inputLeft);
            }
        }

    }

});

// class to represent a column in the grid
grrid.Column = Class.create({

    _position: null,
    _columnName: null,

    getPosition: function(){
        return this._position;
    },

    initialize: function(position) {
        this._position = position;
        this._columnName = grrid.Grid.calculateColumnName(position);
    },

    wireEvents: function(grid) {
        // for columns, we don't actually need to add a physical html element,
        // as this is done by the generateColumnIndicators stuff

        // just find the right column indicator div
        var columnIndicatorName = 'columnIndicator-' + this._position.toString();
        var colIndicatorDiv = $(columnIndicatorName);
        if (colIndicatorDiv) {
            colIndicatorDiv.observe('click', this._selectColumn.bindAsEventListener(this, grid));
        }
      
    },

    unwireEvents: function() {
        // just find the right column indicator div
        var columnIndicatorName = 'columnIndicator-' + this._position.toString();
        var colIndicatorDiv = $(columnIndicatorName);
        if (colIndicatorDiv) {
            Event.stopObserving(colIndicatorDiv, 'click')
        }

    },

    // select a whole col: this is an event handler for the column indicator being clicked.
    _selectColumn: function(event, grid) {
        grid.selectedColumn = this;
    }

});

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
        if (cellToRemove != null) {
            cellToRemove.removeFromGrid(this._grid);
        }
        this._visibleCells.unset([x,y]);
    },

    // get the cell from the collection, at the given coords
    getCell: function(x,y) {
        return this._visibleCells.get([x,y]);
    }
    
});

// class to hold a collection of grid columns, which are visible in the grid.
grrid.VisibleColumnCollection = Class.create();
Object.extend(grrid.VisibleColumnCollection.prototype, Enumerable); // mix in enumerable
Object.extend(grrid.VisibleColumnCollection.prototype, {

    _visibleColumns: $H({}),
    _grid: null,

    initialize: function(grid) {
        this._grid = grid;
    },

    // the iterator for enumerable for
    _each: function(iterator) {
        this._visibleColumns.each( function(column) {
            iterator(column);
        });
    },

    add: function(position, column) {
        this._visibleColumns.set(position, column);
    },
    
    remove: function(position) {
        this._visibleColumns.unset(position);
    },

    getColumn: function(position) {
        return this._visibleColumns.get(position);
    },

    // cause all of the columns in the collection to have their events re wired up.
    rewireEvents: function() {
        this._visibleColumns.each(function(pair) {
            pair.value.unwireEvents(this._grid);
            pair.value.wireEvents(this._grid);            
        }.bind(this));

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
